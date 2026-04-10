import { useState, useEffect } from 'react';
import {
  getCategories, createCategory, updateCategory, deleteCategory,
  getMenuItems, createMenuItem, updateMenuItem, deleteMenuItem, toggleItemAvailability,
  updateStock,
} from '../../services/api';
import LoadingSpinner from '../../components/LoadingSpinner';
import ImageUpload from '../../components/ImageUpload';
import { getApiError } from '../../utils/apiError';
import toast from 'react-hot-toast';

// Group items by category, return array of { category, items[] }
function groupByCategory(items, categories) {
  const catMap = {};
  categories.forEach((c) => { catMap[c.id] = { ...c, items: [] }; });
  catMap['__none__'] = { id: null, name: 'Uncategorized', items: [] };

  items.forEach((item) => {
    const key = item.category_id && catMap[item.category_id] ? item.category_id : '__none__';
    catMap[key].items.push(item);
  });

  return Object.values(catMap).filter((g) => g.items.length > 0);
}

export default function MenuManagementPage() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('items');
  const [itemModal, setItemModal] = useState(null);
  const [catModal, setCatModal] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [restockItem, setRestockItem] = useState(null); // item being restocked

  const loadAll = async () => {
    try {
      const [catRes, itemRes] = await Promise.all([getCategories(), getMenuItems()]);
      setCategories(catRes.data.categories);
      setItems(itemRes.data.items);
    } catch {
      toast.error('Failed to load menu data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const toggleGroup = (key) =>
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleToggle = async (id) => {
    try {
      const { data } = await toggleItemAvailability(id);
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, is_available: data.item.is_available } : i));
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const handleRestock = async (id, qty) => {
    try {
      const { data } = await updateStock(id, { stock_quantity: qty });
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, ...data.item } : i));
      setRestockItem(null);
      toast.success('Stock updated');
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const handleDeleteItem = async (id) => {
    if (!confirm('Delete this menu item?')) return;
    try {
      await deleteMenuItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success('Item deleted');
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const handleDeleteCategory = async (id) => {
    if (!confirm('Delete this category? Items will become uncategorized.')) return;
    try {
      await deleteCategory(id);
      setCategories((prev) => prev.filter((c) => c.id !== id));
      toast.success('Category deleted');
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  if (loading) return <LoadingSpinner />;

  const vegItems = items.filter((i) => i.is_veg);
  const nonVegItems = items.filter((i) => !i.is_veg);
  const vegGroups = groupByCategory(vegItems, categories);
  const nonVegGroups = groupByCategory(nonVegItems, categories);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Menu Management</h1>
        <button onClick={() => setItemModal('new')} className="btn-primary text-sm">
          + Add Item
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {['items', 'categories'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              activeTab === tab
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab} ({tab === 'items' ? items.length : categories.length})
          </button>
        ))}
      </div>

      {/* ── Items tab (3-level view) ── */}
      {activeTab === 'items' && (
        <div className="space-y-6">
          {items.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">
              <p className="text-4xl mb-2">🍽️</p>
              <p>No menu items yet.</p>
              <button onClick={() => setItemModal('new')} className="btn-primary mt-3 text-sm">
                Add your first item
              </button>
            </div>
          ) : (
            <>
              <FoodTypeSection
                type="veg"
                label="Veg"
                icon="🟢"
                groups={vegGroups}
                collapsedGroups={collapsedGroups}
                onToggleGroup={toggleGroup}
                onEdit={(item) => setItemModal(item)}
                onDelete={handleDeleteItem}
                onToggleAvail={handleToggle}
                onRestock={(item) => setRestockItem(item)}
              />
              <FoodTypeSection
                type="nonveg"
                label="Non-Veg"
                icon="🔴"
                groups={nonVegGroups}
                collapsedGroups={collapsedGroups}
                onToggleGroup={toggleGroup}
                onEdit={(item) => setItemModal(item)}
                onDelete={handleDeleteItem}
                onToggleAvail={handleToggle}
                onRestock={(item) => setRestockItem(item)}
              />
            </>
          )}
        </div>
      )}

      {/* ── Categories tab ── */}
      {activeTab === 'categories' && (
        <div className="space-y-3">
          <button onClick={() => setCatModal('new')} className="btn-secondary text-sm">
            + Add Category
          </button>
          {categories.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">No categories yet.</div>
          ) : (
            categories.map((cat) => (
              <div key={cat.id} className="card flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold text-gray-900">{cat.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {items.filter((i) => i.category_id === cat.id).length} items
                  </p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setCatModal(cat)} className="text-xs text-blue-600 hover:underline">Edit</button>
                  <button onClick={() => handleDeleteCategory(cat.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modals */}
      {itemModal !== null && (
        <ItemModal
          item={itemModal === 'new' ? null : itemModal}
          categories={categories}
          onClose={() => setItemModal(null)}
          onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
          onSaved={(saved) => {
            if (itemModal === 'new') {
              setItems((prev) => [...prev, saved]);
            } else {
              setItems((prev) => prev.map((i) => i.id === saved.id ? saved : i));
            }
            setItemModal(null);
          }}
        />
      )}
      {catModal !== null && (
        <CategoryModal
          category={catModal === 'new' ? null : catModal}
          onClose={() => setCatModal(null)}
          onSaved={(saved) => {
            if (catModal === 'new') {
              setCategories((prev) => [...prev, saved]);
            } else {
              setCategories((prev) => prev.map((c) => c.id === saved.id ? saved : c));
            }
            setCatModal(null);
          }}
        />
      )}
      {restockItem && (
        <RestockModal
          item={restockItem}
          onClose={() => setRestockItem(null)}
          onSave={(qty) => handleRestock(restockItem.id, qty)}
        />
      )}
    </div>
  );
}

/* ── Food type section (Veg / Non-Veg) ── */
function FoodTypeSection({ type, label, icon, groups, collapsedGroups, onToggleGroup, onEdit, onDelete, onToggleAvail, onRestock }) {
  const sectionKey = `type-${type}`;
  const isCollapsed = collapsedGroups[sectionKey];

  return (
    <div className="rounded-2xl border-2 overflow-hidden"
      style={{ borderColor: type === 'veg' ? '#bbf7d0' : '#fecaca' }}>
      {/* Level 1: Veg / Non-Veg header */}
      <button
        onClick={() => onToggleGroup(sectionKey)}
        className={`w-full flex items-center justify-between px-5 py-3 font-bold text-base ${
          type === 'veg' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        }`}
      >
        <span className="flex items-center gap-2">{icon} {label}</span>
        <span className="text-sm font-normal text-gray-400">{isCollapsed ? '▼' : '▲'}</span>
      </button>

      {!isCollapsed && (
        <div className="divide-y divide-gray-100">
          {groups.length === 0 ? (
            <p className="text-sm text-gray-400 px-5 py-4">No {label.toLowerCase()} items yet.</p>
          ) : (
            groups.map((group) => {
              const groupKey = `${type}-${group.id || 'none'}`;
              const isCatCollapsed = collapsedGroups[groupKey];
              return (
                <div key={groupKey} className="bg-white">
                  {/* Level 2: Category header */}
                  <button
                    onClick={() => onToggleGroup(groupKey)}
                    className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-xs">└──</span>
                      <span className="font-semibold text-gray-800 text-sm">{group.name}</span>
                      <span className="badge bg-gray-100 text-gray-500">{group.items.length}</span>
                    </div>
                    <span className="text-gray-300 text-xs">{isCatCollapsed ? '▼' : '▲'}</span>
                  </button>

                  {/* Level 3: Items */}
                  {!isCatCollapsed && (
                    <div className="px-5 pb-3 space-y-2">
                      {group.items.map((item) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onToggleAvail={onToggleAvail}
                          onRestock={onRestock}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ── Single item row ── */
function ItemRow({ item, onEdit, onDelete, onToggleAvail, onRestock }) {
  const isOutOfStock = item.track_stock && item.stock_quantity === 0;
  const isLowStock   = item.track_stock && item.stock_quantity > 0 && item.stock_quantity <= 5;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border ${
      isOutOfStock
        ? 'border-red-200 bg-red-50'
        : item.is_available
          ? 'border-gray-100 bg-gray-50'
          : 'border-gray-100 bg-gray-50 opacity-50'
    }`}>
      {item.image_url && (
        <img src={item.image_url} alt={item.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm truncate">{item.name}</p>
        {item.description && (
          <p className="text-xs text-gray-400 truncate">{item.description}</p>
        )}
        {isOutOfStock && (
          <p className="text-xs text-red-500 font-medium mt-0.5">Out of stock — hidden from menu</p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <span className="font-bold text-gray-900 text-sm block">₹{parseFloat(item.price).toFixed(2)}</span>
        {item.track_stock && (
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
            isOutOfStock  ? 'bg-red-100 text-red-600' :
            isLowStock    ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-500'
          }`}>
            {isOutOfStock ? 'Out' : `${item.stock_quantity} left`}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {isOutOfStock ? (
          <button
            onClick={() => onRestock(item)}
            className="text-xs px-2.5 py-1 rounded-full font-semibold bg-brand-100 text-brand-700 hover:bg-brand-200 transition-colors"
          >
            + Restock
          </button>
        ) : (
          <button
            onClick={() => onToggleAvail(item.id)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
              item.is_available
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-red-100 text-red-700 hover:bg-red-200'
            }`}
          >
            {item.is_available ? 'On' : 'Off'}
          </button>
        )}
        {isLowStock && (
          <button
            onClick={() => onRestock(item)}
            className="text-xs px-2 py-1 rounded-full font-medium bg-yellow-100 text-yellow-700 hover:bg-yellow-200 transition-colors"
            title="Low stock — click to restock"
          >
            ↑
          </button>
        )}
        <button onClick={() => onEdit(item)} className="text-xs text-blue-600 hover:underline">Edit</button>
        <button onClick={() => onDelete(item.id)} className="text-xs text-red-500 hover:underline">Delete</button>
      </div>
    </div>
  );
}

/* ── Item Modal ── */
function ItemModal({ item, categories: initialCategories, onClose, onSaved, onCategoryCreated }) {
  const ALLERGEN_TAGS = [
    { key: 'vegan',       label: 'Vegan',        emoji: '🌱' },
    { key: 'gluten-free', label: 'Gluten-Free',   emoji: '🌾' },
    { key: 'dairy-free',  label: 'Dairy-Free',    emoji: '🥛' },
    { key: 'egg-free',    label: 'Egg-Free',      emoji: '🥚' },
    { key: 'nuts',        label: 'Contains Nuts', emoji: '🥜' },
    { key: 'spicy',       label: 'Spicy',         emoji: '🌶️' },
    { key: 'sugar-free',  label: 'Sugar-Free',    emoji: '🍬' },
  ];

  const [form, setForm] = useState({
    name: item?.name || '',
    description: item?.description || '',
    price: item?.price || '',
    category_id: item?.category_id || '',
    image_url: item?.image_url || '',
    is_veg: item?.is_veg ?? true,
    is_available: item?.is_available ?? true,
    track_stock: item?.track_stock ?? false,
    stock_quantity: item?.stock_quantity ?? '',
    tags: item?.tags || [],
  });

  const toggleTag = (key) => setForm((f) => ({
    ...f,
    tags: f.tags.includes(key) ? f.tags.filter((t) => t !== key) : [...f.tags, key],
  }));
  const [localCategories, setLocalCategories] = useState(initialCategories);
  const [newCatName, setNewCatName] = useState('');
  const [showNewCat, setShowNewCat] = useState(false);
  const [creatingCat, setCreatingCat] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    try {
      const { data } = await createCategory({ name: newCatName.trim() });
      const created = data.category;
      setLocalCategories((prev) => [...prev, created]);
      setForm((f) => ({ ...f, category_id: created.id }));
      onCategoryCreated(created);
      setNewCatName('');
      setShowNewCat(false);
      toast.success(`Category "${created.name}" created`);
    } catch {
      toast.error('Failed to create category');
    } finally {
      setCreatingCat(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.price) { toast.error('Name and price are required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        price: parseFloat(form.price),
        category_id: form.category_id || null,
        track_stock: form.track_stock,
        stock_quantity: form.track_stock && form.stock_quantity !== '' ? parseInt(form.stock_quantity) : null,
        tags: form.tags,
      };
      const { data } = item
        ? await updateMenuItem(item.id, payload)
        : await createMenuItem(payload);
      toast.success(item ? 'Item updated' : 'Item added');
      onSaved(data.item);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={item ? 'Edit Item' : 'Add Menu Item'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Veg / Non-Veg toggle */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200">
          <button
            type="button"
            onClick={() => setForm({ ...form, is_veg: true })}
            className={`flex-1 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
              form.is_veg ? 'bg-green-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            🟢 Veg
          </button>
          <button
            type="button"
            onClick={() => setForm({ ...form, is_veg: false })}
            className={`flex-1 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
              !form.is_veg ? 'bg-red-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            🔴 Non-Veg
          </button>
        </div>

        {/* Category — inline chips + create */}
        <div>
          <label className="label">Category</label>
          <div className="flex flex-wrap gap-2">
            {localCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setForm({ ...form, category_id: form.category_id === c.id ? '' : c.id })}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  form.category_id === c.id
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'
                }`}
              >
                {c.name}
              </button>
            ))}

            {/* Inline new category */}
            {showNewCat ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  type="text"
                  placeholder="Category name"
                  className="input py-1.5 text-sm w-36"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory(); } if (e.key === 'Escape') setShowNewCat(false); }}
                />
                <button
                  type="button"
                  onClick={handleCreateCategory}
                  disabled={creatingCat || !newCatName.trim()}
                  className="text-xs bg-brand-500 text-white px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                >
                  {creatingCat ? '...' : 'Add'}
                </button>
                <button type="button" onClick={() => setShowNewCat(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowNewCat(true)}
                className="px-3 py-1.5 rounded-full text-sm font-medium border border-dashed border-gray-300 text-gray-400 hover:border-brand-400 hover:text-brand-500 transition-colors"
              >
                + New
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="label">Item Name *</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>

        <div>
          <label className="label">Description</label>
          <textarea className="input resize-none" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        <div>
          <label className="label">Price (₹) *</label>
          <input type="number" min="0" step="0.01" className="input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="rounded" checked={form.is_available} onChange={(e) => setForm({ ...form, is_available: e.target.checked })} />
          <span>Available for order</span>
        </label>

        {/* Stock tracking */}
        <div className="border border-gray-200 rounded-xl p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer font-medium text-gray-700">
            <input type="checkbox" className="rounded" checked={form.track_stock}
              onChange={(e) => setForm({ ...form, track_stock: e.target.checked, stock_quantity: e.target.checked ? (form.stock_quantity || '') : '' })} />
            Track stock / inventory
          </label>
          {form.track_stock && (
            <div>
              <label className="label text-xs">Current stock quantity</label>
              <input type="number" min="0" className="input" placeholder="e.g. 20"
                value={form.stock_quantity}
                onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} />
              <p className="text-xs text-gray-400 mt-1">Item auto-disables on menu when stock reaches 0</p>
            </div>
          )}
        </div>

        {/* Dietary / allergen tags */}
        <div>
          <label className="label">Dietary & Allergen Tags</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {ALLERGEN_TAGS.map(({ key, label, emoji }) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleTag(key)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  form.tags.includes(key)
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'
                }`}
              >
                {emoji} {label}
              </button>
            ))}
          </div>
        </div>

        <ImageUpload
          value={form.image_url}
          onChange={(url) => setForm({ ...form, image_url: url })}
          uploadType="menu_item"
          label="Item Image"
          aspectClass="aspect-square"
        />

        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Save Item'}</button>
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Category Modal ── */
function CategoryModal({ category, onClose, onSaved }) {
  const [name, setName] = useState(category?.name || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { data } = category
        ? await updateCategory(category.id, { name })
        : await createCategory({ name });
      toast.success(category ? 'Category updated' : 'Category added');
      onSaved(data.category);
    } catch {
      toast.error('Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={category ? 'Edit Category' : 'Add Category'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Category Name *</label>
          <p className="text-xs text-gray-400 mb-2">e.g. Momos, Pizza, Burgers — shared across Veg & Non-Veg</p>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : 'Save'}</button>
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Restock Modal ── */
function RestockModal({ item, onClose, onSave }) {
  const [qty, setQty] = useState(item.stock_quantity > 0 ? item.stock_quantity : '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const n = parseInt(qty);
    if (isNaN(n) || n < 0) return toast.error('Enter a valid quantity');
    setSaving(true);
    await onSave(n);
    setSaving(false);
  };

  return (
    <Modal title={`Restock — ${item.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
          Current stock: <strong>{item.stock_quantity === 0 ? 'Out of stock' : `${item.stock_quantity} left`}</strong>
          {item.stock_quantity === 0 && ' — item is currently hidden from menu'}
        </div>
        <div>
          <label className="label">New Stock Quantity</label>
          <input
            type="number" min="0" className="input" autoFocus
            placeholder="e.g. 50"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">
            Setting to 0 will hide the item from the menu. Setting above 0 will re-enable it automatically.
          </p>
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {saving ? 'Saving...' : 'Update Stock'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Modal wrapper ── */
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
