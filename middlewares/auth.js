const jwt = require('jsonwebtoken');

// Middleware to verify if user is authenticated
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  
  if (!token) {
    return res.status(403).json({ message: 'A token is required for authentication' });
  }
  
  try {
    const tokenBody = token.split(' ')[1]; // Expecting "Bearer <token>"
    const decoded = jwt.verify(tokenBody, process.env.JWT_SECRET || 'secret_key');
    req.user = decoded;
  } catch (err) {
    return res.status(401).json({ message: 'Invalid Token' });
  }
  return next();
};

// Middleware for Role-based Access Control (RBAC)
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Role (${req.user?.role}) is not allowed to access this resource.` 
      });
    }
    next();
  };
};

// Common Role Groups for convenience
const roles = {
  SUPER_ADMIN: 'super_admin',
  MANAGER: 'manager',
  GUARD: 'guard',
  TECHNICIAN: 'technician',
  RESIDENT_PRIMARY: 'resident_primary',
  RESIDENT_FAMILY: 'resident_family'
};

module.exports = {
  verifyToken,
  authorizeRoles,
  roles
};
