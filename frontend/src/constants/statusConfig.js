// Display config — color and label for each status
export const STATUS_CONFIG = {
  pending:   { label: 'Pending',   color: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: 'Accepted',  color: 'bg-blue-100 text-blue-800'    },
  preparing: { label: 'Preparing', color: 'bg-orange-100 text-orange-800' },
  ready:     { label: 'Ready',     color: 'bg-teal-100 text-teal-800'    },
  served:    { label: 'Served',    color: 'bg-green-100 text-green-800'   },
  paid:      { label: 'Paid',      color: 'bg-purple-100 text-purple-800' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800'       },
};

// Order-type-aware next status resolver
// Dine-in:  pending → confirmed → preparing → ready → served → paid
// Takeaway: pending → confirmed → preparing → ready → paid  (served skipped)
export function getNextStatus(status, orderType = 'dine-in') {
  switch (status) {
    case 'pending':   return 'confirmed';
    case 'confirmed': return 'preparing';
    case 'preparing': return 'ready';
    case 'ready':     return orderType === 'takeaway' ? 'paid' : 'served';
    case 'served':    return 'paid';
    default:          return null;
  }
}

// Label for the action button that advances to the next status
export function getActionLabel(status, orderType = 'dine-in') {
  switch (status) {
    case 'pending':   return 'Accept Order';
    case 'confirmed': return 'Start Preparing';
    case 'preparing': return 'Mark as Ready';
    case 'ready':     return orderType === 'takeaway' ? '💵 Collect Payment' : 'Mark as Served';
    case 'served':    return '💵 Collect Payment';
    default:          return null;
  }
}
