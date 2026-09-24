const express = require('express');
const cors = require('cors');
const { RouterOSClient } = require('node-routeros');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ message: 'API Multi-Router MikroTik Activa' });
});

// Endpoint que recibe los datos de conexión por body (POST) o query params
app.post('/api/metrics', async (req, res) => {
    const { host, user, password, port = 8728 } = req.body;

    if (!host || !user || !password) {
        return res.status(400).json({
            status: 'error',
            message: 'Faltan credenciales del router (host, user, password)'
        });
    }

    const client = new RouterOSClient({
        host,
        user,
        password,
        port: parseInt(port),
        timeout: 5000
    });

    try {
        await client.connect();

        // 1. Recursos del sistema
        const sys = (await client.menu('/system/resource').print())[0] || {};
        
        // 2. Estado de Salud (Temperatura/Voltaje si el hardware lo soporta)
        let health = {};
        try {
            const healthData = await client.menu('/system/health').print();
            health = healthData[0] || {};
        } catch (e) { /* Si el router no soporta health, se omite */ }

        // 3. Interfaces de Red
        const interfaces = await client.menu('/interface').print();

        // 4. Clientes DHCP
        const dhcpLeases = await client.menu('/ip/dhcp-server/lease').print();
        const activeDhcp = dhcpLeases.filter(l => l.status === 'bound');

        // 5. Clientes PPPoE
        const pppoeActive = await client.menu('/interface/pppoe-server/active').print();

        // 6. Colas simples (Queues)
        const queues = await client.menu('/queue/simple').print();

        await client.close();

        // Respuesta dinámica para cualquier router
        res.json({
            status: 'online',
            identity: sys['board-name'] || 'MikroTik',
            uptime: sys['uptime'] || 'N/A',
            cpuLoad: parseInt(sys['cpu-load'] || 0),
            cpuCount: sys['cpu-count'] || 1,
            freeMemoryMb: Math.round(parseInt(sys['free-memory'] || 0) / (1024 * 1024)),
            totalMemoryMb: Math.round(parseInt(sys['total-memory'] || 0) / (1024 * 1024)),
            voltage: health['voltage'] ? (health['voltage'] / 10) : null,
            temperature: health['temperature'] || null,
            interfacesCount: interfaces.length,
            clients: {
                total: activeDhcp.length + pppoeActive.length,
                dhcp: activeDhcp.length,
                pppoe: pppoeActive.length
            },
            queuesCount: queues.length
        });

    } catch (error) {
        console.error('Error al conectar con MikroTik:', error.message);
        res.status(500).json({
            status: 'offline',
            error: 'No se pudo establecer conexión con el MikroTik indicado',
            details: error.message
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Backend corriendo en puerto ${PORT}`);
});
