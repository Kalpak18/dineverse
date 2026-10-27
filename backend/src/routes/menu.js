const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const checkSubscription = require('../middleware/checkSubscription');
const {
  getCategories, validateCategory, createCategory, updateCategory, deleteCategory,
  getMenuItems, validateMenuItem, createMenuItem, updateMenuItem, deleteMenuItem,
  toggleAvailability, updateStock, getInventory,
} = require('../controllers/menuController');

// All menu routes require authentication + active subscription
router.use(authenticate, checkSubscription);

// Categories — read allowed for all roles; write/delete restricted to owners
router.get('/categories', getCategories);
router.post('/categories', requireRole('manager'), validateCategory, createCategory);
router.patch('/categories/:id', requireRole('manager'), updateCategory);
router.delete('/categories/:id', requireRole('manager'), deleteCategory);

// Menu items — read allowed for all roles; write/delete restricted to owners
router.get('/items', getMenuItems);
router.post('/items', requireRole('manager'), validateMenuItem, createMenuItem);
router.patch('/items/:id', requireRole('manager'), updateMenuItem);
router.delete('/items/:id', requireRole('manager'), deleteMenuItem);
router.patch('/items/:id/toggle', requireRole('manager'), toggleAvailability);
router.patch('/items/:id/stock',  requireRole('manager'), updateStock);
router.get('/inventory',          requireRole('manager'), getInventory);
router.post('/import',            requireRole('manager'), require('../controllers/menuImportController').importMenu);

module.exports = router;
