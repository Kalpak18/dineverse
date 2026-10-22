// Socket.io `auth` for owner/staff sockets. The server only lets a socket
// join its café room (live orders) with a valid OWNER/STAFF token.
// Passed as a function so every reconnect reads the latest token rather
// than the one captured when the socket was created.
export const ownerSocketAuth = (cb) => cb({ token: localStorage.getItem('dineverse_token') });
