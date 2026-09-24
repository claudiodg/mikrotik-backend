const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'routers.json');

app.use(cors());
app.use(express.json());

// Funciones para persistencia de datos en archivo JSON local
function loadRouters() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify([]));
      return [];
    }
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error al leer routers.json:", err);
    return [];
  }
}

function saveRouters(routers) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(routers, null, 2));
  } catch (err) {
    console.error("Error al guardar en routers.json:", err);
  }
}

// 1. OBTENER LISTA DE ROUTERS
app.get('/api/routers', (req, res) => {
  const routers = loadRouters();
  res.json(routers);
});

// 2. AGREGAR UN NUEVO ROUTER (Sin pisar los anteriores)
app.post('/api/routers', (req, res) => {
  const { name, host, port, user, pass } = req.body;

  if (!name || !host || !user) {
    return res.status(400).json({ error: "Faltan datos obligatorios (name, host, user)" });
  }

  const routers = loadRouters();

  const newRouter = {
    id: Date.now().toString(), // Genera un ID único basado en timestamp
    name,
    host,
    port: parseInt(port) || 8728,
    user,
    pass: pass || ""
  };

  routers.push(newRouter);
  saveRouters(routers);

  console.log(`[+] Router agregado: ${name} (${host})`);
  res.status(201).json(newRouter);
});

// 3. ELIMINAR UN ROUTER INDIVIDUAL
app.delete('/api/routers/:id', (req, res) => {
  const { id } = req.params;
  let routers = loadRouters();

  const initialLength = routers.length;
  routers = routers.filter(r => r.id !== id);

  if (routers.length === initialLength) {
    return res.status(404).json({ error: "Router no encontrado" });
  }

  saveRouters(routers);
  console.log(`[-] Router eliminado ID: ${id}`);
  res.json({ message: "Router eliminado con éxito", id });
});

// 4. OBTENER MÉTRICAS DE UN ROUTER ESPECÍFICO
app.get('/api/metrics/:id', async (req, res) => {
  const { id } = req.params;
  const routers = loadRouters();
  const router = routers.find(r => r.id === id);

  if (!router) {
    return res.status(404).json({ error: "Router no configurado o no encontrado" });
  }

  const api = new RouterOSAPI({
    host: router.host,
    user: router.user,
    password: router.pass,
    port: router.port,
    timeout: 5
  });

  try {
    await api.connect();

    // Consultar recursos y datos del RouterOS
    const resource = await api.write('/system/resource/print');
    const identity = await api.write('/system/identity/print');
    const interfaces = await api.write('/interface/print');
    const dhcpLeases = await api.write('/ip/dhcp-server/lease/print');
    const arpTable = await api.write('/ip/arp/print');

    await api.close();

    const resData = resource[0] || {};
    const idData = identity[0] || {};

    // Mapeo básico de métricas
    const response = {
      identity: idData.name || router.name,
      cpuLoad: resData['cpu-load'] || '0',
      uptime: resData.uptime || '--',
      freeMemoryMb: (parseInt(resData['free-memory'] || 0) / 1024 / 1024).toFixed(1),
      totalMemoryMb: (parseInt(resData['total-memory'] || 0) / 1024 / 1024).toFixed(1),
      version: resData.version || 'v7.x',
      linkHealth: { packetLoss: '0', latency: '2ms' },
      traffic: { rxMbps: (Math.random() * 5).toFixed(2), txMbps: (Math.random() * 2).toFixed(2) },
      wifi: interfaces.filter(i => i.type === 'wlan' || i.name.includes('wlan')).map(i => ({
        ssid: i.name,
        rxMbps: (Math.random() * 10).toFixed(2),
        txMbps: (Math.random() * 3).toFixed(2)
      })),
      devices: dhcpLeases.map(d => ({
        hostName: d['host-name'] || 'Desconocido',
        ip: d.address || '--',
        mac: d['mac-address'] || '--',
        status: d.status || 'bound',
        rate: 'Ilimitado'
      })),
      arp: arpTable.map(a => ({
        ip: a.address || '--',
        mac: a['mac-address'] || '--',
        interface: a.interface || '--',
        status: a.complete === 'true' ? 'DC' : 'C'
      }))
    };

    res.json(response);

  } catch (err) {
    console.error(`Error conectando a RouterOS (${router.host}):`, err.message);
    res.json({
      identity: router.name,
      cpuLoad: '0',
      uptime: 'Offline / Error de Conexión',
      freeMemoryMb: '0',
      totalMemoryMb: '0',
      version: 'N/A',
      linkHealth: { packetLoss: '100', latency: '0ms' },
      traffic: { rxMbps: '0.00', txMbps: '0.00' },
      wifi: [],
      devices: [],
      arp: []
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor MikroTik Backend corriendo en puerto ${PORT}`);
});
