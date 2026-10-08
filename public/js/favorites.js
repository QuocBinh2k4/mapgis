(() => {
    const auth = window.MapAuth;
    let owner = null, status = 'loading', ids = new Set(), serial = 0, refreshPromise;
    const pending = new Set();
    const notify = () => window.dispatchEvent(new CustomEvent('mapgis-favorites-change'));
    async function refresh() {
        const requestSerial = ++serial;
        owner = auth.user?.id || null;
        const requestOwner = owner;
        ids = new Set();
        status = owner ? 'loading' : 'guest';
        pending.clear();
        notify();
        if (!owner) return;
        try {
            const data = await auth.request('/api/me/favorites');
            if (requestSerial !== serial || auth.user?.id !== requestOwner) return;
            ids = new Set(data.items.map(item => Number(item.id)));
            status = 'ready';
        } catch (error) {
            if (requestSerial !== serial) return;
            status = auth.user ? 'error' : 'guest';
        }
        if (requestSerial === serial) notify();
    }
    async function setSaved(id, saved) {
        id = Number(id);
        if (!Number.isSafeInteger(id) || id < 1) throw new Error('Điểm du lịch không hợp lệ.');
        if (!auth.user) throw new Error('Vui lòng đăng nhập để lưu địa điểm yêu thích.');
        if (pending.has(id)) return;
        const requestOwner = auth.user.id, requestSerial = serial;
        pending.add(id);
        notify();
        try {
            await auth.request(`/api/me/favorites/${id}`, { method: saved ? 'PUT' : 'DELETE' });
            if (requestOwner !== auth.user?.id || requestSerial !== serial) return;
            if (saved) ids = new Set([id, ...ids]); else ids.delete(id);
        } finally {
            if (requestSerial === serial) { pending.delete(id); notify(); }
        }
    }
    window.MapFavorites = {
        refresh, setSaved,
        get status() { return status; },
        get count() { return ids.size; },
        get orderedIds() { return [...ids]; },
        has: id => ids.has(Number(id)),
        isPending: id => pending.has(Number(id))
    };
    window.addEventListener('mapgis-auth-change', () => {
        if ((auth.user?.id || null) !== owner) refreshPromise = refresh();
    });
    window.MapFavorites.ready = auth.ready.then(() => {
        if (status === 'loading' && owner === null) refreshPromise = refresh();
        return refreshPromise;
    });
})();
