const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const {
  createPublicReservation,
  getPublicReservationStatus,
  getReservations,
  updateReservation,
  deleteReservation,
} = require('../controllers/reservationController');

// Public: customer books a reservation + polls status
router.post('/cafe/:slug/reserve', createPublicReservation);
router.get('/cafe/:slug/status/:id', getPublicReservationStatus);

// Owner CRUD
router.use(authenticate, checkSubscription, requireOwner);
router.get('/',        getReservations);
router.patch('/:id',   updateReservation);
router.delete('/:id',  deleteReservation);

module.exports = router;
