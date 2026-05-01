const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/modifierController');
const { authenticate } = require('../middleware/auth');
const { checkSubscription } = require('../middleware/checkSubscription');

const auth = [authenticate, checkSubscription];

// ─── Modifier groups ──────────────────────────────────────────
router.get('/',                          ...auth, ctrl.getGroups);
router.post('/',                         ...auth, ctrl.createGroup);
router.patch('/:id',                     ...auth, ctrl.updateGroup);
router.delete('/:id',                    ...auth, ctrl.deleteGroup);

// ─── Options within a group ───────────────────────────────────
router.post('/:groupId/options',              ...auth, ctrl.createOption);
router.patch('/:groupId/options/:optionId',   ...auth, ctrl.updateOption);
router.delete('/:groupId/options/:optionId',  ...auth, ctrl.deleteOption);

// ─── Link groups to items ─────────────────────────────────────
router.get('/items/:itemId',    ...auth, ctrl.getItemGroups);
router.put('/items/:itemId',    ...auth, ctrl.setItemGroups);

// ─── Variants for an item ─────────────────────────────────────
router.get('/items/:itemId/variants',  ...auth, ctrl.getVariants);
router.put('/items/:itemId/variants',  ...auth, ctrl.saveVariants);

// ─── Public: customer ordering ───────────────────────────────
router.get('/public/:itemId', ctrl.getItemModifiers);

module.exports = router;
