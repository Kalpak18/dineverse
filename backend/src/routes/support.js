const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { validateTicket, createTicket, getMyTickets } = require('../controllers/supportController');

router.get('/',  authenticate, getMyTickets);
router.post('/', authenticate, validateTicket, createTicket);

module.exports = router;
