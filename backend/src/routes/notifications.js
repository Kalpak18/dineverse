const express           = require('express');
const router            = express.Router();
const { authenticate }  = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');
const {
  getNotifications, markAllRead, markRead, clearAll,
} = require('../controllers/notificationController');

router.use(authenticate, checkSubscription);

router.get('/',              getNotifications);
router.patch('/read-all',    markAllRead);
router.patch('/:id/read',    markRead);
router.delete('/',           clearAll);

module.exports = router;
