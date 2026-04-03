const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const requireOwner = require('../middleware/requireOwner');
const checkSubscription = require('../middleware/checkSubscription');
const {
  getExpenses, createExpense, validateExpense, deleteExpense,
} = require('../controllers/expenseController');

router.get('/',       authenticate, checkSubscription, getExpenses);
router.post('/',      authenticate, checkSubscription, requireOwner, validateExpense, createExpense);
router.delete('/:id', authenticate, checkSubscription, requireOwner, deleteExpense);

module.exports = router;
