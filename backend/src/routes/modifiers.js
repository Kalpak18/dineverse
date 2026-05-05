const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/modifierController');
const { authenticate } = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');

const auth = [authenticate, checkSubscription];

// ─── Modifier groups ──────────────────────────────────────────
router.get('/groups',                          ...auth, ctrl.getGroups);
router.post('/groups',                         ...auth, ctrl.createGroup);
router.patch('/groups/:id',                    ...auth, ctrl.updateGroup);
router.delete('/groups/:id',                   ...auth, ctrl.deleteGroup);

// ─── Options within a group ───────────────────────────────────
router.post('/groups/:groupId/options',              ...auth, ctrl.createOption);
router.patch('/groups/:groupId/options/:optionId',   ...auth, ctrl.updateOption);
router.delete('/groups/:groupId/options/:optionId',  ...auth, ctrl.deleteOption);

// ─── Link groups to items ─────────────────────────────────────
router.get('/items/:itemId/groups',    ...auth, ctrl.getItemGroups);
router.put('/items/:itemId/groups',    ...auth, ctrl.setItemGroups);
router.get('/categories/:categoryId/groups', ...auth, ctrl.getCategoryGroups);
router.put('/categories/:categoryId/groups', ...auth, ctrl.setCategoryGroups);

// ─── Variants for an item ─────────────────────────────────────
router.get('/items/:itemId/variants',  ...auth, ctrl.getVariants);
router.put('/items/:itemId/variants',  ...auth, ctrl.saveVariants);

// ─── Public: customer ordering (slug + itemId for URL clarity) ───
router.get('/cafe/:slug/items/:itemId/modifiers', ctrl.getItemModifiers);
router.get('/public/:itemId', ctrl.getItemModifiers); // legacy alias

module.exports = router;
