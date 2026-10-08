import unittest
from road_profiles import profile, barrier_access, restriction_modes

class RoadProfilesTest(unittest.TestCase):
    def test_motorway_and_oneway(self):
        permissions, _ = profile({'highway': 'motorway'})
        self.assertEqual(permissions['car'], [True, False])
        for mode in ('motorcycle','bicycle','foot'):
            self.assertEqual(permissions[mode], [False,False])

    def test_reverse_oneway_and_cycle_exception(self):
        p, _ = profile({'highway':'residential','oneway':'-1','oneway:bicycle':'no'})
        self.assertEqual(p['car'],[False,True])
        self.assertEqual(p['motorcycle'],[False,True])
        self.assertEqual(p['bicycle'],[True,True])
        self.assertEqual(p['foot'],[True,True])

    def test_access_hierarchy(self):
        p, _ = profile({'highway':'residential','access':'private','foot':'yes'})
        self.assertEqual(p['car'],[False,False])
        self.assertEqual(p['foot'],[True,True])
        self.assertIsNone(profile({'highway':'service','access':'private'}))

    def test_conditional_access_and_direction(self):
        p, _ = profile({'highway':'residential','motor_vehicle:conditional':'no @ (08:00-10:00)'})
        self.assertEqual(p['car'],[False,False])
        self.assertEqual(p['bicycle'],[True,True])
        p, _ = profile({'highway':'residential','oneway:conditional':'yes @ (08:00-10:00)'})
        self.assertEqual(p['car'],[False,False])
        self.assertEqual(p['foot'],[True,True])

    def test_barrier_and_construction(self):
        self.assertFalse(barrier_access({'barrier':'bollard'},'car'))
        self.assertTrue(barrier_access({'barrier':'bollard'},'foot'))
        self.assertFalse(barrier_access({'barrier':'gate','access':'private'},'foot'))
        self.assertIsNone(profile({'highway':'construction'}))
        self.assertIsNone(profile({'highway':'pedestrian','area':'yes'}))

    def test_speed_limit_and_stairs(self):
        _, speeds = profile({'highway':'primary','maxspeed':'20'})
        self.assertEqual(speeds['car'],20)
        p,_=profile({'highway':'steps'})
        self.assertEqual(p['foot'],[True,True])
        self.assertEqual(p['bicycle'],[False,False])

    def test_turn_exception(self):
        modes=restriction_modes({'restriction':'no_left_turn','except':'bicycle;motorcycle'})
        self.assertEqual(modes,{'car':'no_left_turn'})
        self.assertEqual(restriction_modes({'restriction':'no_left_turn','restriction:motorcycle':'none'}),{'car':'no_left_turn','bicycle':'no_left_turn'})

if __name__=='__main__': unittest.main()
