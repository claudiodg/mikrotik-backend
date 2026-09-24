const express = require('express');
const cors = require('cors');
const { RouterOSClient } = require('node-routeros');

const app = express();
app.use(cors());
app.use(express.json());

// Almacén simple en memoria para los routers agregados desde el Admin
let routersDB = [];

app.get('/', (req, res) => {
    res.json({ message: 'API Multi-Router MikroTik Avanzada' });
});

// Obtener lista de routers
app.get('/api/routers', (req, res) => {
    res.json(routersDB.map(r => ({ id: r.id, name: r.name, host: r.host })));
});

// Guardar nuevo router desde la pestaña Admin
app.post('/api/routers', (req, res) => {
    const { name, host, port, user, pass } = req.body;
    if (!name || !host || !user) {
        return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    const newRouter = { id: Date.now().toString(), name, host, port: port || 8728, user, pass };
    routersDB.push(newRouter);
    res.json(newRouter);
});

// Endpoint principal para consultar todas las métricas de un router
app.get('/api/metrics/:id', async (req, res) => {
    const router = routersDB.find(r => r.id === req.params.id);
    
    // Si no hay routers guardados en memoria, usa variables de entorno como respaldo
    const config = router ? {
        host: router.host,
        user: router.user,
        password: router.pass,
        port: parseInt(router.port),
        timeout: 5000
    } : {
        host: process.env.MIKROTIK_HOST,
        user: process.env.MIKROTIK_USER,
        password: process.env.MIKROTIK_PASSWORD,
        port: parseInt(process.env.MIKROTIK_PORT || '8728'),
        timeout: 5000
    };

    if (!config.host || !config.user) {
        return res.status(400).json({ error: 'Router no configurado' });
    }

    const client = new RouterOSClient(config);

    try {
        await client.connect();

        // 1. Recursos del sistema
        const sys = (await client.menu('/system/resource').print())[0] || {};
        
        // 2. Salud (Temperatura y Voltaje)
        let health = {};
        try { health = (await client.menu('/system/health').print())[0] || {}; } catch(e){}

        // 3. Ping para Packet Loss y Salud de Vínculo (a 8.8.8.8)
        let pingResult = { packetLoss: 0, avgRtt: '0ms' };
        try {
            const pRes = await client.menu('/ping').write({ address: '8.8.8.8', count: 3 });
            if (pRes.length > 0) {
                const received = pRes.filter(p => p.received !== '0').length;
                pingResult.packetLoss = Math.round(((3 - received) / 3) * 100);
                pingResult.avgRtt = pRes[pRes.length - 1]['avg-rtt'] || '0ms';
            }
        } catch(e){}

        // 4. Consumo Redes Wi-Fi (wireless / interface)
        let wifiInterfaces = [];
        try {
            const wlan = await client.menu('/interface/wireless').print();
            for (let w of wlan) {
                const m = await client.menu('/interface').write('monitor-traffic', { interface: w.name, once: true });
                wifiInterfaces.push({
                    name: w.name,
                    ssid: w.ssid || w.name,
                    rxMbps: ((parseInt(m[0]['rx-bits-per-second'] || 0)) / 1000000).toFixed(2),
                    txMbps: ((parseInt(m[0]['tx-bits-per-second'] || 0)) / 1000000).toFixed(2)
                });
            }
        } catch(e){}

        // 5. Tabla ARP y Consumo por Dispositivos (DHCP Lease + ARP)
        const arpTable = await client.menu('/ip/arp').print();
        const dhcpLeases = await client.menu('/ip/dhcp-server/lease').print();
        const simpleQueues = await client.menu('/queue/simple').print();

        const activeClients = dhcpLeases.map(lease => {
            const queue = simpleQueues.find(q => q.target && q.target.includes(lease.address));
            return {
                ip: lease.address,
                mac: lease.mac-address,
                hostName: lease['host-name'] || lease.comment || 'Desconocido',
                status: lease.status,
                rate: queue ? queue['rate'] : 'Sin límite'
            };
        });

        // 6. Sesiones PPPoE
        const pppoeActive = await client.menu('/interface/pppoe-server/active').print();

        await client.close();

        res.json({
            status: 'online',
            identity: sys['board-name'] || 'MikroTik',
            uptime: sys['uptime'] || 'N/A',
            version: sys['version'] || 'v7.x',
            cpuLoad: parseInt(sys['cpu-load'] || 0),
            freeMemoryMb: Math.round(parseInt(sys['free-memory'] || 0) / (1024 * 1024)),
            totalMemoryMb: Math.round(parseInt(sys['total-memory'] || 0) / (1024 * 1024)),
            temperature: health['temperature'] || 'N/A',
            voltage: health['voltage'] ? (health['voltage'] / 10) : 'N/A',
            linkHealth: {
                packetLoss: pingResult.packetLoss,
                latency: pingResult.avgRtt
            },
            wifi: wifiInterfaces,
            arp: arpTable.map(a => ({ ip: a.address, mac: a['mac-address'], interface: a.interface, status: a.complete ? 'Activo' : 'Incompleto' })),
            devices: activeClients,
            clients: {
                total: activeClients.length + pppoeActive.length,
                dhcp: activeClients.length,
                pppoe: pppoeActive.length
            }
        });

    } catch (error) {
        console.error('Error Router:', error.message);
        res.status(500).json({ status: 'offline', error: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Backend activo en puerto ${PORT}`));
