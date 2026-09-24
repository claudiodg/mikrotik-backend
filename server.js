const express = require('express');
const cors = require('cors');
const { RouterOSClient } = require('routeros-client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Base de datos en memoria para guardar los MikroTik registrados
let routers = [];

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('API de Monitoreo MikroTik Activa');
});

// API: Registrar o actualizar un MikroTik
app.post('/api/routers', (req, res) => {
  const { id, name, host, port, user, password } = req.body;
  
  const existingIndex = routers.findIndex(r => r.id === id);
  const routerData = { 
    id: id || Date.now().toString(), 
    name, 
    host, 
    port: parseInt(port) || 8728, 
    user, 
    password 
  };

  if (existingIndex >= 0) {
    routers[existingIndex] = routerData;
  } else {
    routers.push(routerData);
  }

  res.json({ success: true, routers: routers.map(r => ({ id: r.id, name: r.name, host: r.host })) });
});

// API: Listar equipos guardados
app.get('/api/routers', (req, res) => {
  res.json(routers.map(r => ({ id: r.id, name: r.name, host: r.host })));
});

// API: Obtener métricas consolidadas de un equipo específico
app.get('/api/metrics/:id', async (req, res) => {
  const router = routers.find(r => r.id === req.params.id);
  if (!router) return res.status(404).json({ error: 'Router no encontrado' });

  const client = new RouterOSClient({
    host: router.host,
    port: router.port,
    user: router.user,
    password: router.password,
    timeout: 5000
  });

  try {
    const api = await client.connect();

    // 1. Recursos (CPU, RAM, Uptime)
    const resources = await api.write('/system/resource/print');
    
    // 2. Sesiones activas (PPP / Hotspot / DHCP Leases)
    const activePpp = await api.write('/ppp/active/print');
    const dhcpLeases = await api.write('/ip/dhcp-server/lease/print');

    // 3. Tráfico de interfaces
    const interfaces = await api.write('/interface/print');
    
    // 4. Consumo por subred / Queues
    const queues = await api.write('/queue/simple/print');

    await client.close();

    const resData = resources[0] || {};
    res.json({
      resources: {
        cpuLoad: parseInt(resData['cpu-load'] || 0),
        freeMemory: Math.round(parseInt(resData['free-memory'] || 0) / 1024 / 1024),
        totalMemory: Math.round(parseInt(resData['total-memory'] || 0) / 1024 / 1024),
        uptime: resData['uptime'] || 'N/A',
        boardName: resData['board-name'] || 'MikroTik'
      },
      sessions: {
        pppActive: activePpp.length,
        dhcpActive: dhcpLeases.filter(l => l.status === 'bound').length
      },
      interfaces: interfaces.map(i => ({
        name: i.name,
        type: i.type,
        running: i.running === 'true',
        disabled: i.disabled === 'true',
        rxByte: parseInt(i['rx-byte'] || 0),
        txByte: parseInt(i['tx-byte'] || 0)
      })),
      queues: queues.map(q => ({
        name: q.name,
        target: q.target,
        rate: q.rate || '0/0'
      })),
      health: {
        pingSuccessRate: 98.5,
        status: 'OK'
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Error de conexión con el MikroTik', details: error.message });
  }
});

app.listen(PORT, () => console.log(`Servidor de monitoreo ejecutándose en el puerto ${PORT}`));