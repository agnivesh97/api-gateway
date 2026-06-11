const express = require('express');
const app = express();
const PORT = process.env.PORT || 3002;

const orders = [
  { id: 101, userId: 1, item: 'Laptop', amount: 1200 },
  { id: 102, userId: 1, item: 'Monitor', amount: 400 },
  { id: 103, userId: 2, item: 'Keyboard', amount: 80 },
];

app.get('/orders', (req, res) => res.json({ service: 'orders', orders }));
app.get('/orders/:id', (req, res) => {
  const order = orders.find(o => o.id == req.params.id);
  order ? res.json(order) : res.status(404).json({ error: 'not found' });
});
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'orders' }));

app.listen(PORT, () => console.log(`📦 Orders service on :${PORT}`));
