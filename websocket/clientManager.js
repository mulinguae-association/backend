const clients = new Map();

export function addClient(userId, ws) {
  const existingClients = clients.get(userId);
  if (existingClients) {
    existingClients.add(ws);
  } else {
    clients.set(userId, new Set([ws]));
  }
}
export function removeClient(userId, ws) {
  const existingClients = clients.get(userId);
  if (!existingClients) return;
  existingClients.delete(ws);
  if (existingClients.size === 0) {
    clients.delete(userId);
  }
}
export function getClients(userId) {
  return clients.get(userId) ?? new Set();
}

export function getAllClients() {
  return clients;
}
