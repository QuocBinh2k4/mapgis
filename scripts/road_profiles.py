"""Conservative OSM access profiles for a tourism routing graph."""
import re

MODES = ('car', 'motorcycle', 'bicycle', 'foot')
KEYS = {
    'car': ('access', 'vehicle', 'motor_vehicle', 'motorcar'),
    'motorcycle': ('access', 'vehicle', 'motor_vehicle', 'motorcycle'),
    'bicycle': ('access', 'vehicle', 'bicycle'),
    'foot': ('access', 'foot'),
}
ROAD_TYPES = set('motorway motorway_link trunk trunk_link primary primary_link secondary secondary_link tertiary tertiary_link unclassified residential living_street service road track path footway pedestrian steps cycleway bridleway'.split())
ALLOW = {'yes', 'designated', 'permissive', 'official'}
DENY = {'no', 'private', 'agricultural', 'forestry', 'customers', 'delivery', 'permit', 'destination', 'use_sidepath', 'dismount', 'discouraged'}
CAR_SPEED = {'motorway': 90, 'motorway_link': 40, 'trunk': 65, 'trunk_link': 35, 'primary': 50, 'primary_link': 30, 'secondary': 45, 'secondary_link': 25, 'tertiary': 35, 'tertiary_link': 25, 'residential': 25, 'living_street': 10, 'service': 15, 'track': 10}

def access(tags, mode, default):
    result = default
    for key in KEYS[mode]:
        value = tags.get(key, '').lower()
        if value in ALLOW:
            result = True
        elif value in DENY:
            result = False
    # Time-dependent permissions require a departure-time model; exclude for now.
    if any(key + ':conditional' in tags for key in KEYS[mode]):
        result = False
    return result

def profile(tags):
    highway = tags.get('highway', '')
    if highway not in ROAD_TYPES or tags.get('area') == 'yes' or tags.get('construction') or tags.get('proposed'):
        return None
    motor_default = highway not in {'path', 'footway', 'pedestrian', 'steps', 'cycleway', 'bridleway'}
    car_default = motor_default and (highway != 'track' or tags.get('tracktype') in {'grade1', 'grade2'})
    flags = {}
    for mode in MODES:
        default = car_default if mode == 'car' else motor_default if mode == 'motorcycle' else highway not in {'steps', 'footway', 'pedestrian'} if mode == 'bicycle' else True
        allowed = access(tags, mode, default)
        if mode != 'car' and (highway in {'motorway', 'motorway_link'} or tags.get('motorroad') == 'yes'):
            allowed = False
        if mode == 'car' and tags.get('width'):
            try:
                if float(tags['width'].replace('m', '').strip()) < 2:
                    allowed = False
            except ValueError:
                pass
        if tags.get('smoothness') in {'impassable', 'very_horrible', 'horrible'} and mode != 'foot':
            allowed = False
        oneway = tags.get('oneway', 'yes' if tags.get('junction') == 'roundabout' or highway == 'motorway' else 'no')
        if mode == 'foot':
            oneway = tags.get('oneway:foot', 'no')
        elif mode == 'bicycle':
            oneway = tags.get('oneway:bicycle', oneway)
            if any('opposite' in tags.get(k, '') for k in ('cycleway', 'cycleway:left', 'cycleway:right')):
                oneway = 'no'
        else:
            oneway = tags.get('oneway:motor_vehicle', oneway)
            oneway = tags.get('oneway:motorcar' if mode == 'car' else 'oneway:motorcycle', oneway)
        conditional_keys = ['oneway:' + ('motorcar' if mode == 'car' else mode) + ':conditional']
        if mode != 'foot': conditional_keys.append('oneway:conditional')
        if mode in {'car', 'motorcycle'}: conditional_keys.append('oneway:motor_vehicle:conditional')
        if any(key in tags for key in conditional_keys): allowed = False
        forward = allowed and oneway != '-1'
        backward = allowed and oneway not in {'yes', '1', 'true'}
        for direction in ('forward', 'backward'):
            for key in KEYS[mode]:
                if tags.get(key + ':' + direction, '').lower() in DENY or key + ':' + direction + ':conditional' in tags:
                    if direction == 'forward': forward = False
                    else: backward = False
        flags[mode] = [forward, backward]
    if not any(any(value) for value in flags.values()):
        return None
    max_speed = []
    for key in ('maxspeed', 'maxspeed:forward', 'maxspeed:backward'):
        match = re.match(r'^(\d+(?:\.\d+)?)\s*(mph|km/h)?$', tags.get(key, ''))
        if match:
            value = float(match[1]) * (1.609344 if match[2] == 'mph' else 1)
            if value > 0: max_speed.append(value)
    speed = CAR_SPEED.get(highway, 30)
    if max_speed: speed = min(speed, *max_speed)
    if tags.get('surface') in {'unpaved', 'gravel', 'dirt', 'ground', 'sand', 'mud'}: speed = min(speed, 15)
    speeds = {'car': speed, 'motorcycle': min(speed, 40), 'bicycle': 12 if highway in {'path', 'track', 'bridleway'} else 16, 'foot': 3 if highway == 'steps' else 4.5}
    return flags, speeds

def barrier_access(tags, mode):
    barrier = tags.get('barrier', '')
    default = True
    if barrier in {'wall', 'fence', 'hedge', 'retaining_wall', 'block'}: default = False
    if barrier in {'gate', 'lift_gate', 'swing_gate', 'chain', 'bollard', 'bus_trap', 'sump_buster', 'cycle_barrier', 'stile', 'turnstile'} and mode in {'car', 'motorcycle'}: default = False
    if barrier in {'cycle_barrier', 'stile', 'turnstile'} and mode == 'bicycle': default = False
    return access(tags, mode, default)

def restriction_modes(tags):
    result = {}
    exceptions = set(tags.get('except', '').split(';'))
    for mode in MODES:
        key = 'motorcar' if mode == 'car' else mode
        if key in exceptions or (mode in {'car', 'motorcycle'} and ('motor_vehicle' in exceptions or 'vehicle' in exceptions)) or (mode == 'bicycle' and 'vehicle' in exceptions):
            continue
        value = tags.get('restriction:' + key)
        if value is None and mode != 'foot': value = tags.get('restriction:motor_vehicle') if mode in {'car', 'motorcycle'} else None
        if value is None and mode != 'foot': value = tags.get('restriction')
        conditional = tags.get('restriction:' + key + ':conditional') or (tags.get('restriction:conditional') if mode != 'foot' else None)
        if conditional or (value and value != 'none'): result[mode] = conditional or value
    return result
