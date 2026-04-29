const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const {
  getAreas, createArea, updateArea, deleteArea,
  createTable, updateTable, deleteTable,
  getLiveTables,
} = require('../controllers/tableController');

router.use(authenticate, checkSubscription, requireOwner);

// Live floor view
router.get('/live',           getLiveTables);

// Areas
router.get('/areas',          getAreas);
router.post('/areas',         createArea);
router.patch('/areas/:id',    updateArea);
router.delete('/areas/:id',   deleteArea);

// Tables
router.post('/',         createTable);
router.patch('/:id',     updateTable);
router.delete('/:id',    deleteTable);

module.exports = router;
