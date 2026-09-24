const express = require('express');
const cors = require('cors');
const { RouterOSClient } = require('node-routeros');

const app = express();
app.use(cors()); // Permitir peticiones desde tu frontend en GitHub Pages
app.use(express.json());

// Configuración obtenida desde variables de entorno (Render)
const getRouterConfig = () => ({
    host: process.env.MIKROTIK_HOST,
    user: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASSWORD,
    port: parseInt(process.env.MIKROTIK_PORT || '8728'),
    timeout: 5000
});

// Endpoint para obtener métricas reales
app.get('/api/metrics', async (req, res) => {
    const config = getRouterConfig();

    if (!config.host || !config.user || !config.password) {
        return res.status(400).json({
            error: 'Faltan configurar las variables de entorno en Render'
        });
    }

    const client = new RouterOSClient(config);

    try {
        await client.connect();

        // 1. Obtener recursos de sistema (CPU, memoria, uptime, modelo)
        const resourceData = await client.menu('/system/resource').print();
        const sys = resourceData[0] || {};

        // 2. Obtener leases activos de DHCP
        const dhcpLeases = await client.menu('/ip/dhcp-server/lease').print();
        const activeDhcp = dhcpLeases.filter(l => l.status === 'bound').length;

        // 3. Obtener conexiones PPPoE activas
        const pppoeActive = await client.menu('/interface/pppoe-server/active').print();

        await client.close();

        // Responder con estructura limpia
        res.json({
            status: 'online',
            cpuLoad: parseInt(sys['cpu-load'] || 0),
            freeMemoryMb: Math.round(parseInt(sys['free-memory'] || 0) / (1024 * 1024)),
            totalMemoryMb: Math.round(parseInt(sys['total-memory'] || 0) / (1024 * 1024)),
            boardName: sys['board-name'] || 'MikroTik',
            uptime: sys['uptime'] || 'N/A',
            clients: {
                total: activeDhcp + pppoeActive.length,
                dhcp: activeDhcp,
                pppoe: pppoeActive.length
            }
        });

    } catch (error) {
        console.error('Error MikroTik:', error.message);
        res.status(500).json({
            status: 'offline',
            error: 'No se pudo conectar al MikroTik',
            details: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend corriendo en puerto ${PORT}`);
});
