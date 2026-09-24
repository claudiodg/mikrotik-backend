const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Base de datos temporal en memoria (o array de routers)
let routers = [
  {
    id: "default",
    name: "MikroTik Principal",
    host: "192.168.88.1",
    port: 8728,
    user: "admin",
    pass: ""
  }
];

// 1. Obtener la lista de routers guardados
app.get('/api/routers', (req, res) => {
  res.json(routers);
});

// 2. Registrar un nuevo Router MikroTik desde el Panel Admin
app.post('/api/routers', (req, res) => {
  const { name, host, port, user, pass } = req.body;
  if (!name || !host) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  const newRouter = {
    id: "router-" + Date.now(),
    name,
    host,
    port: port || 8728,
    user: user || "admin",
    pass: pass || ""
  };

  routers.push(newRouter);
  res.status(201).json(newRouter);
});

// 3. Obtener métricas dinámicas de un router específico por su ID
app.get('/api/metrics/:id', (req, res) => {
  const routerId = req.params.id;
  const router = routers.find(r => r.id === routerId);

  if (!router) {
    return res.status(404).json({ error: "Router no encontrado" });
  }

  // Aquí conectas con RouterOS API usando router.host, router.user, router.pass
  // Por ahora devolvemos la estructura con datos de prueba/simulados
  res.json({
    id: router.id,
    name: router.name,
    resources: {
      cpuLoad: Math.floor(Math.random() * 20) + 5,
      freeMemory: 128,
      totalMemory: 256,
      uptime: "3d 12h 04m",
      boardName: "RB951Ui-2HnD",
      version: "7.12.1"
    },
    traffic: {
      rxMbps: (Math.random() * 18 + 2).toFixed(1),
      txMbps: (Math.random() * 6 + 1).toFixed(1)
    },
    sessions: {
      pppActive: 12,
      dhcpActive: 28
    }
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor de monitoreo ejecutándose en el puerto ${PORT}`);
});
