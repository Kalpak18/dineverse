import { useState, useRef, useCallback } from 'react';
import { aiMenuImport, createCategory, createMenuItem } from '../services/api';
import toast from 'react-hot-toast';

const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ReviewItemRow({ item, onToggleSelect, onToggleVeg, onChangeName, onChangePrice }) {
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2.5 transition-opacity ${!item.selected ? 'opacity-40' : ''}`}>
      <input
        type="checkbox"
        checked={item.selected}
        onChange={onToggleSelect}
        className="rounded flex-shrink-0 accent-orange-500"
      />
      <button
        type="button"
        onClick={onToggleVeg}
        className="flex-shrink-0 text-base leading-none"
        title={item.is_veg ? 'Veg — click to mark Non-Veg' : 'Non-Veg — click to mark Veg'}
      >
        {item.is_veg ? '🟢' : '🔴'}
      </button>
      <input
        type="text"
        value={item.name}
        onChange={(e) => onChangeName(e.target.value)}
        className="flex-1 text-sm border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-brand-400 rounded px-1 min-w-0"
        placeholder="Item name"
      />
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <span className="text-xs text-gray-400">₹</span>
        <input
          type="number"
          min="0"
          step="0.5"
          value={item.price ?? ''}
          onChange={(e) => onChangePrice(e.target.value === '' ? null : parseFloat(e.target.value))}
          className="w-20 text-sm text-right border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-brand-400 rounded px-1"
          placeholder="—"
        />
      </div>
    </div>
  );
}

export default function AIMenuImport({ existingCategories, onDone, onClose }) {
  const [stage, setStage]           = useState('upload');
  const [file, setFile]             = useState(null);
  const [preview, setPreview]       = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError]           = useState(null);
  const [dragOver, setDragOver]     = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const inputRef = useRef(null);

  const handleFile = useCallback((selectedFile) => {
    if (!ACCEPTED_MIME.includes(selectedFile.type)) {
      setError('Only JPEG, PNG, and WebP images are supported.');
      return;
    }
    if (selectedFile.size > MAX_BYTES) {
      setError('Image must be under 5 MB.');
      return;
    }
    setError(null);
    setFile(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleAnalyse = async () => {
    if (!file) return;
    setStage('processing');
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      const { data } = await aiMenuImport(base64, file.type);
      setCategories(
        data.categories.map((cat) => ({
          ...cat,
          items: cat.items.map((item) => ({ ...item, selected: true })),
        }))
      );
      setStage('review');
    } catch (err) {
      const msg = err.response?.data?.message || 'AI processing failed. Please try again.';
      setError(msg);
      setStage('upload');
    }
  };

  const toggleItem = (ci, ii) => setCategories((prev) =>
    prev.map((cat, c) => c !== ci ? cat : {
      ...cat,
      items: cat.items.map((item, i) => i !== ii ? item : { ...item, selected: !item.selected }),
    })
  );

  const updateItemField = (ci, ii, field, value) => setCategories((prev) =>
    prev.map((cat, c) => c !== ci ? cat : {
      ...cat,
      items: cat.items.map((item, i) => i !== ii ? item : { ...item, [field]: value }),
    })
  );

  const allSelected = categories.every((c) => c.items.every((i) => i.selected));
  const toggleSelectAll = () => setCategories((prev) =>
    prev.map((cat) => ({ ...cat, items: cat.items.map((item) => ({ ...item, selected: !allSelected })) }))
  );

  const selectedCount = categories.reduce((acc, cat) => acc + cat.items.filter((i) => i.selected).length, 0);

  const handleImport = async () => {
    const selectedItems = categories.flatMap((cat) =>
      cat.items.filter((i) => i.selected).map((i) => ({ ...i, categoryName: cat.name }))
    );
    if (selectedItems.length === 0) { toast.error('Select at least one item to import'); return; }

    setStage('importing');
    setImportProgress({ done: 0, total: selectedItems.length });

    // Build case-insensitive map of existing category names → id
    const catMap = {};
    existingCategories.forEach((c) => { catMap[c.name.toLowerCase()] = c.id; });

    const newlyCreated = {};
    const createdItems = [];
    const createdCats  = [];
    let done = 0;

    for (const item of selectedItems) {
      const catKey = item.categoryName.toLowerCase();
      let categoryId = catMap[catKey] || newlyCreated[catKey] || null;

      if (!categoryId && catKey !== 'uncategorized') {
        try {
          const { data } = await createCategory({ name: item.categoryName });
          categoryId = data.category.id;
          newlyCreated[catKey] = categoryId;
          catMap[catKey] = categoryId;
          createdCats.push(data.category);
        } catch { /* import item without category */ }
      }

      try {
        const { data } = await createMenuItem({
          name:        item.name,
          price:       item.price ?? 0,
          description: item.description || null,
          category_id: categoryId || null,
          is_veg:      item.is_veg,
          is_available: true,
        });
        createdItems.push(data.item);
      } catch { /* skip failed item */ }

      done += 1;
      setImportProgress({ done, total: selectedItems.length });
    }

    toast.success(`Imported ${createdItems.length} of ${selectedItems.length} items`);
    onDone(createdItems, createdCats);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900">Import Menu from Photo</h3>
            <p className="text-xs text-gray-400 mt-0.5">AI-powered · Powered by Claude</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">

          {/* ── UPLOAD ── */}
          {stage === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Photograph your physical menu card and AI will extract all items, categories, and veg/non-veg classification automatically.
              </p>

              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-2xl cursor-pointer transition-colors overflow-hidden
                  ${dragOver ? 'border-brand-400 bg-brand-50' : 'border-gray-300 bg-gray-50 hover:border-brand-400 hover:bg-brand-50'}`}
              >
                {preview ? (
                  <img src={preview} alt="Menu preview" className="w-full max-h-64 object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-2 py-14 px-4 text-center">
                    <span className="text-5xl">📷</span>
                    <p className="text-sm font-medium text-gray-700">
                      {dragOver ? 'Drop the photo here' : 'Click or drag your menu photo here'}
                    </p>
                    <p className="text-xs text-gray-400">JPEG, PNG, WebP — max 5 MB</p>
                  </div>
                )}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_MIME.join(',')}
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
              />

              {preview && (
                <p className="text-xs text-gray-400 text-center">
                  {file?.name} · {(file.size / 1024).toFixed(0)} KB
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); setError(null); }}
                    className="ml-2 text-red-400 hover:text-red-600"
                  >✕ Remove</button>
                </p>
              )}

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleAnalyse}
                  disabled={!file}
                  className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  ✨ Analyse with AI
                </button>
                <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
              </div>
            </div>
          )}

          {/* ── PROCESSING ── */}
          {stage === 'processing' && (
            <div className="flex flex-col items-center gap-4 py-16">
              <div className="w-12 h-12 border-4 border-brand-400 border-t-transparent rounded-full animate-spin" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700">Reading your menu…</p>
                <p className="text-xs text-gray-400 mt-1">This can take up to 30 seconds</p>
              </div>
            </div>
          )}

          {/* ── REVIEW ── */}
          {stage === 'review' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Found <strong>{categories.reduce((a, c) => a + c.items.length, 0)}</strong> items
                  in <strong>{categories.length}</strong> {categories.length === 1 ? 'category' : 'categories'}.
                  Review before importing.
                </p>
                <button onClick={toggleSelectAll} className="text-xs text-brand-600 hover:underline flex-shrink-0">
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>

              <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                {categories.map((cat, catIdx) => (
                  <div key={catIdx} className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="bg-gray-50 px-3 py-2 font-semibold text-sm text-gray-700 border-b border-gray-100 flex items-center gap-2">
                      <span>{cat.name}</span>
                      <span className="text-xs font-normal text-gray-400">{cat.items.length} items</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {cat.items.map((item, itemIdx) => (
                        <ReviewItemRow
                          key={itemIdx}
                          item={item}
                          onToggleSelect={() => toggleItem(catIdx, itemIdx)}
                          onToggleVeg={() => updateItemField(catIdx, itemIdx, 'is_veg', !item.is_veg)}
                          onChangeName={(v) => updateItemField(catIdx, itemIdx, 'name', v)}
                          onChangePrice={(v) => updateItemField(catIdx, itemIdx, 'price', v)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-gray-400">
                Click 🟢/🔴 to toggle veg/non-veg. Click item name or price to edit inline.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={handleImport}
                  disabled={selectedCount === 0}
                  className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Import {selectedCount} item{selectedCount !== 1 ? 's' : ''}
                </button>
                <button onClick={() => setStage('upload')} className="btn-secondary flex-1">
                  ← Back
                </button>
              </div>
            </div>
          )}

          {/* ── IMPORTING ── */}
          {stage === 'importing' && (
            <div className="flex flex-col items-center gap-5 py-12">
              <div className="w-full bg-gray-100 rounded-full h-2.5">
                <div
                  className="bg-brand-500 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${importProgress.total > 0 ? (importProgress.done / importProgress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-sm text-gray-600">
                Creating items… {importProgress.done} / {importProgress.total}
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
