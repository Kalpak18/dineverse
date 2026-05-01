const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/shiftController');
const { authenticate } = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');

const auth = [authenticate, checkSubscription];

router.post('/open',       ...auth, ctrl.openShift);
router.post('/close',      ...auth, ctrl.closeShift);
router.get('/current',     ...auth, ctrl.getCurrentShift);
router.get('/',            ...auth, ctrl.getShifts);
router.get('/:id/summary', ...auth, ctrl.getShiftSummary);

module.exports = router;
