// utils/onlineUsers.js

const onlineUsers = new Map();

export function addOnlineUser(userId, socketId) {
  onlineUsers.set(userId, socketId);
}

export function removeOnlineUserBySocket(socketId) {
  for (const [userId, sId] of onlineUsers.entries()) {
    if (sId === socketId) {
      onlineUsers.delete(userId);
      break;
    }
  }
}

export function getSocketIdByUserId(userId) {
  return onlineUsers.get(userId);
}

export function getOnlineUsers() {
  return onlineUsers;
}
