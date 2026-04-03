const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const { validateStaff, getStaff, createStaff, deleteStaff } = require('../controllers/staffController');

// All staff management requires owner auth + active subscription
router.use(authenticate, checkSubscription, requireOwner);

router.get('/', getStaff);
router.post('/', validateStaff, createStaff);
router.delete('/:id', deleteStaff);

module.exports = router;
