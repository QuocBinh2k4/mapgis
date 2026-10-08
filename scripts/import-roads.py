import collections
import datetime
import json
import os
from pathlib import Path
import re
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / '.tools' / 'roads-python'))
import osmium
import psycopg
from psycopg.types.json import Jsonb
from road_profiles import MODES, ROAD_TYPES, profile, barrier_access, restriction_modes

DIRECTORY = ROOT / 'data' / 'roads'
PBF = DIRECTORY / 'vietnam.osm.pbf'

def connection():
    if os.environ.get('DATABASE_URL'): return psycopg.connect(os.environ['DATABASE_URL'])
    if os.environ.get('PGHOST') or os.environ.get('PGDATABASE'): return psycopg.connect('')
    source = (ROOT / 'server.js').read_text(encoding='utf-8-sig')
    block = re.search(r'new Pool\(\{([\s\S]*?)\}\)', source).group(1)
    config = {key: re.search(key + r"\s*:\s*['\"](.*?)['\"]", block).group(1) for key in ('user', 'host', 'database', 'password')}
    config['dbname'] = config.pop('database')
    config['port'] = int(re.search(r'port:\s*(\d+)', block).group(1))
    return psycopg.connect(**config)

class Scan(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.counts = collections.Counter()
        self.barriers = {}
        self.restrictions = []
        self.ways = 0

    def node(self, node):
        if 'barrier' in node.tags or any(key in node.tags for key in ('access', 'motorcar', 'motorcycle', 'bicycle', 'foot')):
            self.barriers[node.id] = dict(node.tags)

    def way(self, way):
        if way.tags.get('highway') not in ROAD_TYPES: return
        tags = dict(way.tags)
        if profile(tags) is None: return
        self.ways += 1
        self.counts.update(n.ref for n in way.nodes)
        if self.ways % 100000 == 0: print(f'Scanned {self.ways:,} eligible ways', flush=True)

    def relation(self, relation):
        if relation.tags.get('type') != 'restriction': return
        tags = dict(relation.tags)
        modes = restriction_modes(tags)
        if modes:
            self.restrictions.append({'id': relation.id, 'tags': tags, 'modes': modes, 'members': [{'type': m.type, 'ref': m.ref, 'role': m.role} for m in relation.members]})

class ImportWays(osmium.SimpleHandler):
    def __init__(self, scan, copy, blocked):
        super().__init__()
        self.scan, self.copy, self.blocked = scan, copy, blocked
        self.edges = 0
        self.invalid = 0

    def way(self, way):
        if way.tags.get('highway') not in ROAD_TYPES: return
        tags = dict(way.tags)
        result = profile(tags)
        if result is None: return
        flags, speeds = result
        for mode in self.blocked.get(way.id, []): flags[mode] = [False, False]
        if not any(any(v) for v in flags.values()): return
        try:
            points = [(n.ref, n.lon, n.lat) for n in way.nodes]
        except osmium.InvalidLocationError:
            self.invalid += 1
            return
        if len(points) < 2: return
        split = [0] + [i for i in range(1, len(points) - 1) if self.scan.counts[points[i][0]] > 1 or points[i][0] in self.scan.barriers] + [len(points) - 1]
        if points[0][0] == points[-1][0] and len(split) == 2:
            split.insert(1, len(points) // 2)
        for begin, end in zip(split, split[1:]):
            segment = points[begin:end + 1]
            if segment[0][0] == segment[-1][0] or len(set((p[1], p[2]) for p in segment)) < 2: continue
            permissions = {mode: list(values) for mode, values in flags.items()}
            for node_id in (segment[0][0], segment[-1][0]):
                barrier = self.scan.barriers.get(node_id)
                if barrier:
                    for mode in MODES:
                        if not barrier_access(barrier, mode): permissions[mode] = [False, False]
            if not any(any(v) for v in permissions.values()): continue
            geometry = 'SRID=4326;LINESTRING(' + ','.join(f'{lon} {lat}' for _, lon, lat in segment) + ')'
            row = [way.id, segment[0][0], segment[-1][0], tags.get('name:vi', tags.get('name', tags.get('ref', ''))), tags['highway'], geometry]
            for mode in MODES: row.extend([*permissions[mode], speeds[mode]])
            row.append(Jsonb(tags))
            self.copy.write_row(row)
            self.edges += 1
            if self.edges % 100000 == 0: print(f'{self.edges:,} road segments copied', flush=True)

def main():
    if not PBF.exists(): raise RuntimeError('Run node scripts/download-roads.js first')
    started = time.time()
    source = json.loads((DIRECTORY / 'source.json').read_text())
    print('Pass 1: scanning intersections, access barriers and turn restrictions...', flush=True)
    scan = Scan()
    scan.apply_file(str(PBF), filters=[osmium.filter.KeyFilter('highway','barrier','access','motorcar','motorcycle','bicycle','foot','type')])
    print(f'{scan.ways:,} eligible ways; {len(scan.counts):,} road nodes; {len(scan.restrictions):,} restriction relations', flush=True)
    (DIRECTORY / 'turn-source.json').write_text(json.dumps(scan.restrictions,ensure_ascii=False),encoding='utf-8')
    blocked = collections.defaultdict(set)
    supported = []
    unsupported = []
    for item in scan.restrictions:
        frm = [m['ref'] for m in item['members'] if m['role'] == 'from' and m['type'] == 'w']
        to = [m['ref'] for m in item['members'] if m['role'] == 'to' and m['type'] == 'w']
        via = [m['ref'] for m in item['members'] if m['role'] == 'via' and m['type'] == 'n']
        for mode, kind in item['modes'].items():
            if len(frm) == len(to) == len(via) == 1 and (kind.startswith('no_') or kind.startswith('only_')) and '@' not in kind:
                supported.append((item['id'], frm[0], to[0], via[0], mode, kind))
            else:
                for way_id in frm: blocked[way_id].add(mode)
                unsupported.append({'relation': item['id'], 'mode': mode, 'restriction': kind, 'action': 'exclude_from_way_for_mode'})
    job = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
    edge_table, vertex_table, turn_table = (f'routing.{name}_{job}' for name in ('edges', 'vertices', 'turns'))
    with connection() as conn:
        conn.execute('CREATE EXTENSION IF NOT EXISTS pgrouting')
        conn.execute('CREATE SCHEMA IF NOT EXISTS routing')
        conn.execute("SELECT pg_advisory_xact_lock(hashtext('mapgis-roads-import'))")
        columns = ','.join(f'{mode}_forward boolean NOT NULL,{mode}_backward boolean NOT NULL,{mode}_speed double precision NOT NULL' for mode in MODES)
        conn.execute(f'''CREATE TABLE {edge_table} (
            id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            osm_way_id bigint NOT NULL, source bigint NOT NULL,target bigint NOT NULL,
            name text,highway text NOT NULL,geom geometry(LineString,4326) NOT NULL,
            {columns},tags jsonb NOT NULL,length_m double precision)''')
        names = 'osm_way_id,source,target,name,highway,geom,' + ','.join(f'{mode}_forward,{mode}_backward,{mode}_speed' for mode in MODES) + ',tags'
        print('Pass 2: constructing and importing the routing graph...', flush=True)
        with conn.cursor().copy(f'COPY {edge_table} ({names}) FROM STDIN') as copy:
            handler = ImportWays(scan, copy, blocked)
            handler.apply_file(str(PBF), locations=True, idx='flex_mem', filters=[osmium.filter.KeyFilter('highway')])
        print('Calculating lengths and building spatial indexes...', flush=True)
        for mode in MODES:
            keys = ['oneway:' + ('motorcar' if mode == 'car' else mode) + ':conditional']
            if mode != 'foot': keys.append('oneway:conditional')
            if mode in {'car','motorcycle'}: keys.append('oneway:motor_vehicle:conditional')
            conn.execute(f'UPDATE {edge_table} SET {mode}_forward=false,{mode}_backward=false WHERE tags ?| %s', (keys,))
        conn.execute(f'UPDATE {edge_table} SET length_m=ST_Length(geom::geography)')
        conn.execute(f'ALTER TABLE {edge_table} ALTER COLUMN length_m SET NOT NULL')
        conn.execute(f'CREATE INDEX ON {edge_table} USING gist(geom)')
        conn.execute(f'CREATE INDEX ON {edge_table} (source)')
        conn.execute(f'CREATE INDEX ON {edge_table} (target)')
        conn.execute(f'CREATE INDEX ON {edge_table} (osm_way_id)')
        conn.execute(f'''CREATE TABLE {vertex_table} AS SELECT DISTINCT ON(id) id,geom FROM (
            SELECT source AS id,ST_StartPoint(geom) AS geom FROM {edge_table}
            UNION ALL SELECT target,ST_EndPoint(geom) FROM {edge_table}) x ORDER BY id''')
        conn.execute(f'ALTER TABLE {vertex_table} ADD PRIMARY KEY(id)')
        conn.execute(f'CREATE INDEX ON {vertex_table} USING gist(geom)')
        conn.execute(f'''CREATE TABLE {turn_table} (
            relation_id bigint,via_node bigint,from_edge bigint,to_edge bigint,mode text,
            PRIMARY KEY(relation_id,via_node,from_edge,to_edge,mode))''')
        print('Importing turn restrictions...', flush=True)
        for relation_id, from_way, to_way, via, mode, kind in supported:
            # Keep both geometric directions as pgRouting restriction paths use edge IDs.
            # The shared via node ensures the restriction is attached to the actual junction.
            if kind.startswith('only_'):
                condition = '(b.osm_way_id<>%s' + (' OR b.id=a.id)' if from_way == to_way else ')')
            else:
                condition = 'b.osm_way_id=%s' + (' AND b.id=a.id' if kind == 'no_u_turn' and from_way == to_way else '')
            conn.execute(f'''INSERT INTO {turn_table}
                SELECT %s,%s,a.id,b.id,%s FROM {edge_table} a JOIN {edge_table} b
                  ON (b.source=%s OR b.target=%s)
                WHERE a.osm_way_id=%s AND (a.source=%s OR a.target=%s)
                  AND {condition}
                  AND (a.{mode}_forward OR a.{mode}_backward) AND (b.{mode}_forward OR b.{mode}_backward)
                ON CONFLICT DO NOTHING''', (relation_id,via,mode,via,via,from_way,via,via,to_way))
        conn.execute(f'CREATE INDEX ON {turn_table}(mode)')
        conn.execute(f'ANALYZE {edge_table}')
        conn.execute(f'ANALYZE {vertex_table}')
        conn.execute(f'ANALYZE {turn_table}')
        invalid = conn.execute(f'SELECT count(*) FROM {edge_table} WHERE length_m<=0 OR NOT ST_IsValid(geom) OR source=target').fetchone()[0]
        if invalid: raise RuntimeError(f'{invalid} invalid road segments; transaction rolled back')
        stats = {'edges': handler.edges, 'vertices': conn.execute(f'SELECT count(*) FROM {vertex_table}').fetchone()[0], 'turn_restrictions': conn.execute(f'SELECT count(*) FROM {turn_table}').fetchone()[0], 'invalid_source_ways': handler.invalid, 'conservatively_excluded_restrictions': len(unsupported)}
        for mode in MODES:
            stats[mode] = conn.execute(f'SELECT count(*) FROM {edge_table} WHERE {mode}_forward OR {mode}_backward').fetchone()[0]
        for name, table in [('edges',edge_table),('vertices',vertex_table),('turns',turn_table)]:
            if conn.execute('SELECT to_regclass(%s)', ('routing.'+name,)).fetchone()[0]:
                conn.execute(f'ALTER TABLE routing.{name} RENAME TO {name}_backup_{job}')
            conn.execute(f'ALTER TABLE {table} RENAME TO {name}')
        conn.execute('CREATE TABLE IF NOT EXISTS routing.imports(id text PRIMARY KEY,imported_at timestamptz NOT NULL DEFAULT now(),source jsonb,stats jsonb)')
        conn.execute('INSERT INTO routing.imports(id,source,stats) VALUES(%s,%s,%s)', (job,Jsonb(source),Jsonb(stats)))
        report = {'job':job, 'source':source, 'stats':stats, 'elapsed_seconds':round(time.time()-started), 'excluded_restrictions':unsupported}
    (DIRECTORY / 'import-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({key:value for key,value in report.items() if key!='excluded_restrictions'},indent=2),flush=True)

if __name__ == '__main__':
    main()
