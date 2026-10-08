(() => {
    window.createMapLayers = (map, layers) => {
        const toggle = document.getElementById('map-layer-toggle');
        const panel = document.getElementById('map-layer-panel');
        const container = document.getElementById('map-container');
        const options = [...panel.querySelectorAll('[data-layer]')];
        let active = 'street';
        function setOpen(open, restoreFocus = false) {
            panel.hidden = !open;
            toggle.setAttribute('aria-expanded', String(open));
            container.classList.toggle('layers-open', open);
            if (open) { map.closePopup(); options.find(button => button.dataset.layer === active)?.focus(); }
            else if (restoreFocus) toggle.focus();
        }
        toggle.addEventListener('click', () => setOpen(panel.hidden));
        document.getElementById('map-layer-close').addEventListener('click', () => setOpen(false, true));
        document.addEventListener('pointerdown', event => {
            if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); setOpen(false, true); }
        });
        options.forEach(button => button.addEventListener('click', () => {
            const key = button.dataset.layer;
            if (!layers[key]) return;
            if (key !== active) { map.removeLayer(layers[active]); layers[key].addTo(map); active = key; }
            options.forEach(option => {
                const selected = option.dataset.layer === active;
                option.classList.toggle('active', selected); option.setAttribute('aria-pressed', String(selected));
            });
            const label = button.querySelector('strong').textContent;
            toggle.setAttribute('aria-label', `Chọn lớp bản đồ, hiện tại: ${label}`);
            setOpen(false, true);
        }));
        return { close: () => setOpen(false) };
    };
})();
