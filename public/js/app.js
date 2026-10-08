(() => {
    'use strict';
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('toggle-btn');
    const list = document.getElementById('result-list');
    const count = document.getElementById('result-count');
    const search = document.getElementById('searchInput');
    const mobile = window.matchMedia('(max-width: 760px), (max-height: 500px) and (pointer: coarse)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const guide = document.getElementById('guide');
    let map;
    let markerGroup;
    let routingUI;
    let mapLayers;
    let provinceLayer;
    let selectedLayer;
    let selectedProvince = '';
    let selectedType = 'all';
    const favorites = window.MapFavorites;
    let favoritesOnly = new URLSearchParams(location.search).get('view') === 'favorites';
    let spots = [];
    let loadState = 'loading';
    const pageSize = 40;
    let visibleLimit = pageSize;
    const categories = {
        DI_TICH: { label: 'Di tích lịch sử', icon: 'fa-landmark', color: '#8e44ad' },
        DANH_LAM: { label: 'Danh lam thắng cảnh', icon: 'fa-mountain-sun', color: '#27ae60' },
        TAM_LINH: { label: 'Tâm linh', icon: 'fa-vihara', color: '#c37a10' },
        KHU_DU_LICH: { label: 'Khu du lịch - Vui chơi', icon: 'fa-umbrella-beach', color: '#087fbd' },
        BAO_TANG: { label: 'Bảo tàng - Triển lãm', icon: 'fa-building-columns', color: '#bd586d' }
    };
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const icon = name => {
        const node = element('i', `fa-solid ${name}`);
        node.setAttribute('aria-hidden', 'true');
        return node;
    };
    function setSidebar(open) {
        sidebar.classList.toggle('collapsed', !open);
        sidebar.inert = !open;
        document.getElementById('app-container').classList.toggle('sidebar-open', open);
        document.getElementById('sidebar-backdrop').hidden = !open || !mobile.matches;
        if (open && mobile.matches) mapLayers?.close();
        toggle.setAttribute('aria-expanded', String(open));
        toggle.title = open ? 'Ẩn danh sách điểm đến' : 'Mở danh sách điểm đến';
        toggle.setAttribute('aria-label', toggle.title);
        if (map) setTimeout(() => map.invalidateSize(), reducedMotion.matches ? 0 : 320);
    }
    toggle.addEventListener('click', () => setSidebar(sidebar.classList.contains('collapsed')));
    document.getElementById('close-sidebar').addEventListener('click', () => {
        setSidebar(false);
        toggle.focus();
    });
    document.getElementById('sidebar-backdrop').addEventListener('click', () => { setSidebar(false); toggle.focus(); });
    setSidebar(!mobile.matches);
    mobile.addEventListener('change', () => setSidebar(!mobile.matches));
    document.getElementById('guide-link').addEventListener('click', event => {
        event.preventDefault();
        guide.showModal();
    });
    document.getElementById('close-guide').addEventListener('click', () => guide.close());
    document.getElementById('start-exploring').addEventListener('click', () => {
        guide.close();
        setSidebar(true);
        search.focus();
    });
    document.querySelector('.skip-link').addEventListener('click', event => {
        setSidebar(true);
        if (!document.getElementById('route-panel').hidden) {
            event.preventDefault();
            document.getElementById('route-start').focus();
        }
    });
    document.querySelector('.nav-link.current').addEventListener('click', () => setSidebar(false));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && mobile.matches && !guide.open && !sidebar.classList.contains('collapsed')) {
            setSidebar(false);
            toggle.focus();
        }
    });
    function showEmpty(title, message, retry = false) {
        const state = element('div', 'empty-state');
        state.append(icon(retry ? 'fa-cloud-arrow-down' : 'fa-compass'), element('h3', '', title), element('p', '', message));
        if (retry) {
            const button = element('button', 'retry-button', 'Thử lại');
            button.type = 'button';
            button.addEventListener('click', loadSpots);
            state.append(button);
        }
        list.replaceChildren(state);
    }
    function message(text) {
        const node = document.getElementById('map-message');
        node.textContent = text;
        node.hidden = !text;
    }
    // Chỉ dùng URL ảnh HTTP(S) hoặc ảnh cùng website, tránh chèn HTML từ dữ liệu API.
    function imageFor(props, className) {
        if (!props.hinh_anh) return null;
        let url;
        try { url = new URL(props.hinh_anh, document.baseURI); } catch { return null; }
        if (!['https:', 'http:'].includes(url.protocol)) return null;
        const image = element('img', className);
        image.src = url.href;
        image.alt = props.ten_dia_diem || 'Ảnh điểm đến';
        image.loading = 'lazy';
        image.addEventListener('error', () => image.remove(), { once: true });
        return image;
    }
    function focusSpot(spot) {
        // Đưa marker trở lại nhóm nếu bộ lọc hiện tại đang ẩn điểm được mở từ liên kết.
        if (!markerGroup.hasLayer(spot.marker)) markerGroup.addLayer(spot.marker);
        if (mobile.matches) {
            setSidebar(false);
            toggle.focus();
        }
        map.setView(spot.marker.getLatLng(), 13, { animate: !reducedMotion.matches });
        if (markerGroup.zoomToShowLayer) markerGroup.zoomToShowLayer(spot.marker, () => spot.marker.openPopup());
        else spot.marker.openPopup();
    }
    function renderSpots(resetPage = true) {
        if (loadState !== 'ready') return;
        if (resetPage) visibleLimit = pageSize;
        const query = normalize(search.value);
        const visible = spots.filter(spot => {
            const props = spot.feature.properties;
            return (!favoritesOnly || (favorites.status === 'ready' && favorites.has(props.id)))
                && (!favoritesOnly || document.getElementById('map-collection').value === 'all' || !document.getElementById('map-collection').value || favorites.collection?.(props.id) === document.getElementById('map-collection').value)
                && (selectedType === 'all' || props.ma_loai === selectedType)
                && (!selectedProvince || normalize(props.ten_tinh) === normalize(selectedProvince))
                && (!query || normalize(`${props.ten_dia_diem || ''} ${props.ten_tinh || ''}`).includes(query));
        });
        const visibleSet = new Set(visible);
        if (favoritesOnly) {
            const order = new Map(favorites.orderedIds.map((id, index) => [id, index]));
            visible.sort((a, b) => order.get(a.feature.properties.id) - order.get(b.feature.properties.id));
        }
        if (resetPage) {
            const add = [];
            const remove = [];
            spots.forEach(spot => {
                const displayed = markerGroup.hasLayer(spot.marker);
                if (visibleSet.has(spot) && !displayed) add.push(spot.marker);
                if (!visibleSet.has(spot) && displayed) remove.push(spot.marker);
            });
            if (markerGroup.removeLayers) markerGroup.removeLayers(remove);
            else remove.forEach(marker => markerGroup.removeLayer(marker));
            if (markerGroup.addLayers) markerGroup.addLayers(add);
            else add.forEach(marker => markerGroup.addLayer(marker));
        }
        count.textContent = `${visible.length} điểm đến`;
        list.setAttribute('aria-busy', 'false');
        if (favoritesOnly && favorites.status !== 'ready') {
            const state = element('div', 'empty-state');
            state.append(icon('fa-heart'));
            if (favorites.status === 'guest') {
                count.textContent = 'Chưa đăng nhập';
                state.append(element('h3', '', 'Lưu những nơi bạn muốn đến'), element('p', '', 'Đăng nhập để xem danh sách địa điểm yêu thích của bạn.'));
                const login = element('a', 'secondary-button favorite-login', 'Đăng nhập bằng Google');
                login.href = '/account?return=' + encodeURIComponent('/?view=favorites');
                state.append(login);
            } else if (favorites.status === 'loading') {
                count.textContent = 'Đang tải…';
                list.setAttribute('aria-busy', 'true');
                state.append(element('h3', '', 'Đang tải địa điểm yêu thích…'));
            } else {
                count.textContent = 'Chưa kết nối';
                state.append(element('h3', '', 'Chưa tải được danh sách yêu thích'), element('p', '', 'Vui lòng kiểm tra kết nối và thử lại.'));
                const retry = element('button', 'retry-button', 'Thử lại');
                retry.type = 'button'; retry.addEventListener('click', () => favorites.refresh()); state.append(retry);
            }
            list.replaceChildren(state); return;
        }
        if (!visible.length) {
            if (favoritesOnly && !favorites.count) showEmpty('Chưa có địa điểm yêu thích', 'Mở một điểm trên bản đồ và chọn “Thêm vào yêu thích” để lưu cho chuyến đi tiếp theo.');
            else showEmpty('Chưa tìm thấy điểm đến', spots.length ? 'Thử từ khóa khác, chọn “Tất cả” hoặc bỏ lọc tỉnh thành.' : 'Chưa có điểm du lịch trong dữ liệu. Hãy quay lại sau nhé.');
            return;
        }
        const cards = visible.slice(0, visibleLimit).map(spot => {
            const props = spot.feature.properties;
            const category = categories[props.ma_loai];
            const card = element('button', 'result-card');
            card.type = 'button';
            const thumbnail = element('span', 'card-image');
            thumbnail.append(icon(category?.icon || 'fa-location-dot'));
            const image = imageFor(props);
            if (image) {
                thumbnail.firstChild.hidden = true;
                image.addEventListener('error', () => { thumbnail.firstChild.hidden = false; }, { once: true });
                thumbnail.append(image);
            }
            const info = element('span', 'info');
            info.append(element('span', 'card-category', props.loai_hinh || category?.label || 'Khám phá'));
            info.append(element('strong', 'card-title', props.ten_dia_diem || 'Điểm du lịch'));
            const location = element('span', 'card-location');
            location.append(icon('fa-location-dot'), document.createTextNode(props.ten_tinh || 'Việt Nam'));
            info.append(location);
            card.append(thumbnail, info);
            card.addEventListener('click', () => focusSpot(spot));
            if (!favoritesOnly) return card;
            const savedCard = element('div', 'favorite-result');
            const remove = element('button', 'text-button favorite-remove', 'Bỏ yêu thích');
            remove.type = 'button'; remove.disabled = favorites.isPending(props.id);
            remove.setAttribute('aria-label', `Bỏ yêu thích ${props.ten_dia_diem || 'điểm du lịch'}`);
            remove.addEventListener('click', async () => {
                try { await favorites.setSaved(props.id, false); message('Đã bỏ địa điểm khỏi danh sách yêu thích.'); }
                catch (error) { message(error.message); }
            });
            savedCard.append(card, remove); return savedCard;
        });
        list.replaceChildren(...cards);
        if (visible.length > visibleLimit) {
            const more = element('button', 'retry-button load-more', `Xem thêm điểm đến (${visible.length - visibleLimit})`);
            more.type = 'button';
            more.addEventListener('click', () => {
                visibleLimit += pageSize;
                renderSpots(false);
                const nextCard = list.children[visibleLimit - pageSize];
                if (nextCard) nextCard.focus();
            });
            list.append(more);
        }
    }
    document.getElementById('search-form').addEventListener('submit', event => { event.preventDefault(); renderSpots(); });
    function updateFavoriteViews() {
        document.getElementById('collection-filter').hidden = !favoritesOnly;
        document.getElementById('favorites-count').textContent = favorites.status === 'loading' ? '…' : favorites.status === 'error' ? '!' : favorites.count;
        document.getElementById('results-heading').textContent = favoritesOnly ? 'Địa điểm yêu thích của bạn' : 'Điểm đến dành cho bạn';
        for (const [id, active] of [['view-explore', !favoritesOnly], ['view-favorites', favoritesOnly]]) {
            const button = document.getElementById(id);
            button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
        }
        spots.forEach(spot => {
            const button = spot.favoriteButton;
            if (!button) return;
            const saved = favorites.has(spot.feature.properties.id);
            button.textContent = saved ? 'Bỏ yêu thích' : 'Thêm vào yêu thích';
            button.setAttribute('aria-pressed', String(saved));
            button.disabled = favorites.status === 'loading' || favorites.isPending(spot.feature.properties.id);
        });
    }
    document.getElementById('view-explore').addEventListener('click', () => { favoritesOnly = false; updateFavoriteViews(); renderSpots(); });
    document.getElementById('map-collection').addEventListener('change', () => renderSpots());
    document.getElementById('view-favorites').addEventListener('click', () => {
        favoritesOnly = true; search.value = ''; selectedType = 'all';
        document.querySelectorAll('.tag').forEach(tag => { const active = tag.dataset.type === 'all'; tag.classList.toggle('active', active); tag.setAttribute('aria-pressed', String(active)); });
        updateFavoriteViews(); clearProvince();
    });
    window.addEventListener('mapgis-favorites-change', () => { updateFavoriteViews(); if (favoritesOnly) renderSpots(); });
    updateFavoriteViews();
    search.addEventListener('input', renderSpots);
    document.querySelectorAll('.tag').forEach(button => button.addEventListener('click', () => {
        selectedType = button.dataset.type;
        document.querySelectorAll('.tag').forEach(tag => {
            const active = tag === button;
            tag.classList.toggle('active', active);
            tag.setAttribute('aria-pressed', String(active));
        });
        renderSpots();
    }));
    function clearProvince() {
        selectedProvince = '';
        if (selectedLayer && provinceLayer) provinceLayer.resetStyle(selectedLayer);
        selectedLayer = null;
        document.getElementById('province-selection').hidden = true;
        renderSpots();
    }
    document.getElementById('clear-province').addEventListener('click', clearProvince);
    document.getElementById('reset-map').addEventListener('click', () => {
        if (!map) return;
        clearProvince();
        map.closePopup();
        if (provinceLayer?.getBounds().isValid()) map.fitBounds(provinceLayer.getBounds(), { padding: [20, 20], animate: !reducedMotion.matches });
        else map.setView([16, 106], 6, { animate: !reducedMotion.matches });
    });
    if (typeof L === 'undefined') {
        loadState = 'error';
        count.textContent = 'Chưa kết nối';
        list.setAttribute('aria-busy', 'false');
        showEmpty('Chưa tải được bản đồ', 'Kiểm tra kết nối Internet rồi tải lại trang.');
        message('Không thể tải thư viện bản đồ. Vui lòng tải lại trang.');
        return;
    }
    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 });
    const satellite = L.tileLayer('https://mt0.google.com/vt/lyrs=y&hl=vi&x={x}&y={y}&z={z}', { attribution: '&copy; Google Satellite', maxZoom: 20 });
    const terrain = L.tileLayer('https://mt0.google.com/vt/lyrs=p&hl=vi&x={x}&y={y}&z={z}', { attribution: '&copy; Google Terrain', maxZoom: 20 });
    map = L.map('map', { center: [16, 106], zoom: 6, layers: [street], zoomControl: false });
    markerGroup = (L.markerClusterGroup
        ? L.markerClusterGroup({ showCoverageOnHover: false, animate: !reducedMotion.matches, maxClusterRadius: 55 })
        : L.featureGroup()).addTo(map);
    if (window.createRoutingUI) routingUI = window.createRoutingUI(map, {
        showSidebar: setSidebar,
        findOrigins(query) {
            const term = normalize(query);
            if (term.length < 2) return [];
            return spots.filter(spot => normalize(`${spot.feature.properties.ten_dia_diem} ${spot.feature.properties.ten_tinh || ''}`).includes(term)).slice(0, 6).map(spot => spot.feature);
        }
    });
    map.attributionControl.addAttribution('Điểm đến &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>');
    L.control.zoom({ position: 'topright' }).addTo(map);
    if (window.createMapLayers) mapLayers = window.createMapLayers(map, { street, satellite, terrain });
    if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('map-container'));
    async function getFeatures(path) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(path, { signal: controller.signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.type !== 'FeatureCollection' || (data.features !== null && !Array.isArray(data.features))) throw new Error('Dữ liệu bản đồ không hợp lệ');
            return { ...data, features: data.features || [] };
        } finally { clearTimeout(timeout); }
    }
    async function loadProvinces() {
        try {
            const data = await getFeatures('/api/ranhgioi');
            provinceLayer = L.geoJSON(data, {
                style: { color: '#40796b', weight: 1, fillColor: '#5ba58c', fillOpacity: .12 },
                onEachFeature(feature, layer) {
                    const props = feature.properties || {};
                    const name = String(props.ten_tinh || 'Tỉnh thành');
                    layer.bindTooltip(element('span', '', name), { direction: 'center' });
                    const popup = element('div');
                    popup.append(element('strong', '', name));
                    if (props.dien_tich != null) popup.append(element('p', '', `Diện tích: ${props.dien_tich} km²`));
                    if (props.dan_so != null) popup.append(element('p', '', `Dân số: ${props.dan_so} người`));
                    layer.bindPopup(popup);
                    layer.on('click', event => {
                        if (routingUI?.pickStart(event.latlng)) return;
                        if (selectedLayer) provinceLayer.resetStyle(selectedLayer);
                        selectedLayer = layer;
                        selectedProvince = props.ten_tinh || '';
                        layer.setStyle({ color: '#087f70', weight: 3, fillOpacity: .25 });
                        layer.bringToFront();
                        map.fitBounds(layer.getBounds(), { padding: [30, 30], animate: !reducedMotion.matches });
                        document.getElementById('selected-province').textContent = selectedProvince;
                        document.getElementById('province-selection').hidden = !selectedProvince;
                        renderSpots();
                        setSidebar(true);
                    });
                }
            }).addTo(map);
            if (provinceLayer.getBounds().isValid() && !selectedProvince && !spots.some(spot => spot.marker.isPopupOpen())) map.fitBounds(provinceLayer.getBounds(), { padding: [20, 20] });
        } catch (error) {
            message('Chưa tải được ranh giới tỉnh thành. Bạn vẫn có thể tìm điểm đến bằng ô tìm kiếm.');
            console.error('Lỗi tải ranh giới:', error);
        }
    }
    async function loadSpots() {
        loadState = 'loading';
        count.textContent = 'Đang tải…';
        list.setAttribute('aria-busy', 'true');
        showEmpty('Hành trình sắp bắt đầu', 'Đang tìm các điểm đến trên bản đồ…');
        try {
            const data = await getFeatures('/api/diemdulich');
            markerGroup.clearLayers();
            spots = [];
            data.features.forEach(feature => {
                const coords = feature.geometry?.coordinates;
                if (feature.geometry?.type !== 'Point' || !Array.isArray(coords) || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return;
                const props = feature.properties || {};
                feature.properties = props;
                const category = categories[props.ma_loai] || { icon: 'fa-location-dot', color: '#087f70' };
                const pin = element('div', 'tourist-pin');
                pin.style.backgroundColor = category.color;
                pin.append(icon(category.icon));
                const marker = L.marker([coords[1], coords[0]], {
                    title: props.ten_dia_diem || 'Điểm du lịch',
                    icon: L.divIcon({ className: 'custom-tourist-marker', html: pin, iconSize: [32, 32], iconAnchor: [16, 16] })
                });
                const popup = element('div', 'spot-popup');
                const image = imageFor(props);
                if (image) popup.append(image);
                popup.append(element('h3', '', props.ten_dia_diem || 'Điểm du lịch'), element('span', 'card-category', props.loai_hinh || category.label || 'Khám phá'));
                if (props.mo_ta_ngan) popup.append(element('p', '', props.mo_ta_ngan));
                if (props.ten_tinh) popup.append(element('p', 'card-location', props.ten_tinh));
                if (routingUI) {
                    const directions = element('button', 'primary-button popup-directions', 'Chỉ đường đến đây');
                    directions.type = 'button';
                    directions.addEventListener('click', () => routingUI.open(feature));
                    popup.append(directions);
                }
                let favoriteButton;
                if (favorites) {
                    const save=element('button','secondary-button popup-directions','Thêm vào yêu thích');save.type='button';
                    favoriteButton=save;
                    save.addEventListener('click',async()=>{
                        save.disabled=true;
                        try {
                            await favorites.ready;
                            if(!window.MapAuth.user){location.assign(`/account?return=${encodeURIComponent(`/?place=${props.id}`)}`);return;}
                            if(favorites.status==='error') await favorites.refresh();
                            if(favorites.status!=='ready') throw new Error('Chưa tải được danh sách yêu thích. Vui lòng thử lại.');
                            const saved=!favorites.has(props.id);
                            await favorites.setSaved(props.id,saved);
                            message(saved?'Đã thêm địa điểm vào danh sách yêu thích.':'Đã bỏ địa điểm khỏi danh sách yêu thích.');
                        }catch(error){message(error.message);}finally{updateFavoriteViews();}
                    });popup.append(save);
                }
                const planLink = element('a', 'secondary-button popup-directions', 'Lưu bộ sưu tập / thêm vào lịch trình');
                planLink.href = `/journeys?place=${props.id}`;
                popup.append(planLink);
                marker.bindPopup(popup).bindTooltip(element('span', '', props.ten_dia_diem || 'Điểm du lịch'), { direction: 'top', offset: [0, -15] });
                marker.on('click', event => {
                    if (routingUI?.pickStart(event.latlng)) map.closePopup();
                });
                spots.push({ feature, marker, favoriteButton });
            });
            loadState = 'ready';
            updateFavoriteViews();
            renderSpots();
            const requested=Number(new URLSearchParams(location.search).get('place'));
            const selected=spots.find(spot=>spot.feature.properties.id===requested);
            if(selected)focusSpot(selected);
        } catch (error) {
            loadState = 'error';
            count.textContent = 'Chưa kết nối';
            list.setAttribute('aria-busy', 'false');
            showEmpty('Chưa tải được điểm đến', 'Vui lòng thử lại sau ít phút hoặc kiểm tra kết nối máy chủ.', true);
            console.error('Lỗi tải điểm du lịch:', error);
        }
    }
    loadProvinces();
    loadSpots();
})();
