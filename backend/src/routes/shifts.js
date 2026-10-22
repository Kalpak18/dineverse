const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/shiftController');
const { authenticate } = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');
const requireRole = require('../middleware/requireRole');

const auth = [authenticate, checkSubscription, requireRole('manager', 'cashier')];

router.post('/open',       ...auth, ctrl.openShift);
router.post('/close',      ...auth, ctrl.closeShift);
router.get('/current',     ...auth, ctrl.getCurrentShift);
router.get('/',            ...auth, ctrl.getShifts);
router.get('/:id/summary', ...auth, ctrl.getShiftSummary);

module.exports = router;
