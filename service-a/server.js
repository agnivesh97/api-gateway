const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;

const users = [
  { id: 1, name: 'Agnivesh', email: 'agnivesh@example.com' },
  { id: 2, name: 'Sakshi', email: 'sakshi@example.com' },
];

app.get('/users', (req, res) => res.json({ service: 'users', users }));
app.get('/users/:id', (req, res) => {
  const user = users.find(u => u.id == req.params.id);
  user ? res.json(user) : res.status(404).json({ error: 'not found' });
});
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'users' }));

app.listen(PORT, () => console.log(`👤 Users service on :${PORT}`));
