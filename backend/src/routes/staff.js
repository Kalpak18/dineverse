const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const { validateStaff, getStaff, createStaff, updateStaff, deleteStaff, resetStaffPassword } = require('../controllers/staffController');

// All staff management requires owner auth + active subscription
router.use(authenticate, checkSubscription, requireOwner);

router.get('/', getStaff);
router.post('/', validateStaff, createStaff);
router.patch('/:id', updateStaff);
router.patch('/:id/reset-password', resetStaffPassword);
router.delete('/:id', deleteStaff);

module.exports = router;
