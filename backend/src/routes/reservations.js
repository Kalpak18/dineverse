const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const checkSubscription = require('../middleware/checkSubscription');
const {
  createPublicReservation,
  getPublicReservationStatus,
  checkReservationByPhone,
  getReservations,
  updateReservation,
  deleteReservation,
} = require('../controllers/reservationController');

// Public: customer books a reservation + polls status + checks for existing reservation by phone
router.post('/cafe/:slug/reserve', createPublicReservation);
router.get('/cafe/:slug/status/:id', getPublicReservationStatus);
router.get('/cafe/:slug/check', checkReservationByPhone);

// Owner CRUD
router.use(authenticate, checkSubscription, requireRole('manager', 'cashier'));
router.get('/',        getReservations);
router.patch('/:id',   updateReservation);
router.delete('/:id',  deleteReservation);

module.exports = router;
