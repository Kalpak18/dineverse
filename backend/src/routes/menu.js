const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const { aiImportLimiter } = require('../middleware/rateLimiter');
const {
  getCategories, validateCategory, createCategory, updateCategory, deleteCategory,
  getMenuItems, validateMenuItem, createMenuItem, updateMenuItem, deleteMenuItem,
  toggleAvailability, updateStock, getInventory,
} = require('../controllers/menuController');
const { aiMenuImport } = require('../controllers/aiMenuController');

// All menu routes require authentication + active subscription
router.use(authenticate, checkSubscription);

// Categories — read allowed for all roles; write/delete restricted to owners
router.get('/categories', getCategories);
router.post('/categories', requireOwner, validateCategory, createCategory);
router.patch('/categories/:id', requireOwner, updateCategory);
router.delete('/categories/:id', requireOwner, deleteCategory);

// Menu items — read allowed for all roles; write/delete restricted to owners
router.get('/items', getMenuItems);
router.post('/items', requireOwner, validateMenuItem, createMenuItem);
router.patch('/items/:id', requireOwner, updateMenuItem);
router.delete('/items/:id', requireOwner, deleteMenuItem);
router.patch('/items/:id/toggle', requireOwner, toggleAvailability);
router.patch('/items/:id/stock',  requireOwner, updateStock);
router.get('/inventory',          requireOwner, getInventory);
router.post('/ai-import',         requireOwner, aiImportLimiter, express.json({ limit: '5mb' }), aiMenuImport);

module.exports = router;
