"""M16A2 service rifle, built with gunkit (see gunkit.py for conventions).

Gun space (Blender): bore axis along +Y at x = z = 0, upper receiver rear face at y = 0, meters.
The lower receiver, A2 pistol grip and hand placement match the procedural M4A1 in
src/player/gunModels.js, so the first-person arms grip both rifles the same way.
Animated parts (empties with children): m16_mag, m16_bolt, m16_chargingHandle, m16_trigger.
Markers: m16_web (grip origin), m16_muzzle, m16_ejectPort, m16_rightHand, m16_leftHand,
m16_rearSight (aperture centre), m16_frontSight (post tip).
"""
import math

from gunkit import (
    DEG, TAU, TEXT_LEFT, Kit, box, circle, cyl, fillet, hull, join, knurl, lathe, loft, prism, ring_y,
    rrect, span_box, text_mesh, torus, xform,
)

UP_T, UP_B, UP_F = 0.0235, -0.0165, 0.176   # upper receiver roof, parting line, front face
SIGHT_Z = 0.064                             # sight line above the bore
AP_Y = 0.0265                               # rear aperture plane
GA = 20 * DEG                               # pistol grip rake
MAG_PIVOT = (0.0, 0.1325, -0.0765)


def gp(u, v):
    """Pistol grip frame: u runs down the grip axis, v toward the rear (same numbers as the M4A1)."""
    return (-(0.011 + v * math.cos(GA) + u * math.sin(GA)), -0.046 - u * math.cos(GA) + v * math.sin(GA))


def build():
    k = Kit('M16A2', 'm16')
    upper(k)
    rear_sight(k)
    lower(k)
    grip_and_guard(k)
    stock(k)
    front_end(k)
    moving_parts(k)
    magazine(k)
    markers(k)
    return k


# ----------------------------------------------------------------------------- upper receiver

def upper(k):
    sec = fillet([(-0.0145, UP_B, 0.0005), (0.0145, UP_B, 0.0005), (0.0145, 0.0125, 0.002),
                  (0.0102, UP_T, 0.0025), (-0.0102, UP_T, 0.0025), (-0.0145, 0.0125, 0.002)], segs=3)
    body = prism(sec, 'Y', 0.0, UP_F)
    # integral carry handle: beam + sloped front pillar, wider rear-sight housing, protective ears
    handle = prism(fillet([(0.003, UP_T - 0.003), (0.003, 0.0505, 0.002), (0.008, 0.0555, 0.003), (0.046, 0.0555, 0.001),
                           (0.052, 0.0545, 0.001), (0.146, 0.0545, 0.004), (0.172, UP_T + 0.0008, 0.006), (0.176, UP_T - 0.003)], segs=4),
                   'X', -0.0080, 0.0080)
    housing = prism(fillet([(0.003, UP_T - 0.003), (0.003, 0.0505, 0.002), (0.008, 0.0555, 0.0025), (0.046, 0.0555, 0.002),
                            (0.052, 0.0500, 0.003), (0.052, UP_T - 0.003)], segs=3), 'X', -0.0098, 0.0098)
    ears = [prism(fillet([(0.0105, 0.0545), (0.0415, 0.0545), (0.0352, 0.0745, 0.0025), (0.0185, 0.0745, 0.0025)], segs=3), 'X', a, b)
            for a, b in ((-0.0098, -0.0049), (0.0049, 0.0098))]
    # brass deflector and forward assist housing (right side)
    deflector = hull([(x, y, z) for y, x0, x1, z0, z1 in ((0.047, 0.012, 0.0152, -0.006, 0.0125), (0.038, 0.012, 0.0215, -0.005, 0.0125),
                                                         (0.029, 0.012, 0.0192, -0.003, 0.0105)) for x in (x0, x1) for z in (z0, z1)])
    fa = xform(cyl(0.0064, 0.022, 24), at=(0.0118, 0.019, 0.0085), rot=(0, 0, -150 * DEG))
    fa_boss = xform(box(0.006, 0.02, 0.012), at=(0.0122, 0.024, 0.0070), rot=(0, 0, -150 * DEG))
    cuts = [
        cyl(0.0126, 0.2, 48, at=(0, 0.09, 0)),                                          # bolt carrier bore
        prism(rrect(0.047, -0.0088, 0.106, 0.0098, 0.0018), 'X', 0.006, 0.03),         # ejection port
        span_box(-0.0072, 0.0072, -0.01, 0.020, 0.0165, 0.0245),                       # charging handle channel
        prism(fillet([(0.058, UP_T - 0.0003, 0), (0.1395, UP_T - 0.0003, 0), (0.1325, 0.0415, 0.009), (0.0625, 0.0415, 0.009)], segs=6),
              'X', -0.02, 0.02),                                                        # carry handle opening
        span_box(-0.02, 0.02, 0.0185, 0.0355, 0.0395, 0.0515),                          # elevation drum window
        prism([(-0.0024, 0.0560), (0.0024, 0.0560), (0.0, 0.0526)], 'Y', 0.050, 0.150), # sighting groove
    ]
    k.add('m16_upper', body, 'anod', bevel=(0.0005, 2), union=[handle, housing, *ears, deflector, fa, fa_boss], cut=cuts)

    # forward assist (A2 round button) + dust cover (open) with hinge rod
    plunger = lathe([(0, -0.006), (0.0047, -0.006), (0.0050, -0.004), (0.0050, 0.0035), (0.0045, 0.0052), (0.0026, 0.0059), (0, 0.0059)], 32)
    xform(plunger, rot=(0, 0, -150 * DEG))
    xform(plunger, at=(0.0178, 0.0085, 0.0085))
    k.add('m16_forwardAssist', plunger, 'park', bevel=(0.0003, 2))
    cover = box(0.0012, 0.060, 0.019, rot=(0, -16 * DEG, 0))
    lip = box(0.0016, 0.058, 0.003, at=(0.0009, 0, -0.0078), rot=(0, -16 * DEG, 0))
    spring = box(0.0008, 0.012, 0.004, at=(-0.0006, -0.018, 0.006), rot=(0, -16 * DEG, 0))
    cov = join(cover, lip, spring)
    xform(cov, at=(0.0178, 0.0765, -0.0202))
    k.add('m16_dustCover', cov, 'park', bevel=(0.00025, 1))
    k.add('m16_dustCoverRod', cyl(0.0011, 0.066, 12, at=(0.0153, 0.0765, -0.0105)), 'steel', bevel=(0.0002, 1))


def rear_sight(k):
    # elevation drum (vertical axis) seen through the window, knurled rim
    drum = lathe([(0, 0.0402), (0.0068, 0.0402), (0.0079, 0.0411, 1), (0.0079, 0.0499, 1), (0.0068, 0.0508), (0.0022, 0.0508), (0, 0.0508)],
                 72, axis='Z', center=(0, 0.027), mod=knurl(36, 0.07))
    hub = cyl(0.0028, 0.0145, 16, axis='Z', at=(0, 0.027, 0.0455))
    k.add('m16_elevationDrum', join(drum, hub), 'park', bevel=(0.0002, 1))
    # windage knob on the right ear + screw end on the left
    knob = lathe([(0, 0.0096), (0.0060, 0.0096), (0.0068, 0.0104, 1), (0.0068, 0.0133, 1), (0.0061, 0.0141), (0.0022, 0.0144), (0, 0.0144)],
                 64, axis='X', center=(0.027, 0.0600), mod=knurl(28, 0.08))
    screw = lathe([(0, -0.0106), (0.0021, -0.0106), (0.0023, -0.0100), (0.0023, -0.0090), (0, -0.0090)], 16, axis='X', center=(0.027, 0.0600))
    k.add('m16_windage', join(knob, screw), 'park', bevel=(0.0002, 1))
    # dual flip aperture (large aperture up, small one folded back)
    leaf = prism(fillet([(-0.0044, 0.0552), (0.0044, 0.0552), (0.0044, 0.0712, 0.0034), (-0.0044, 0.0712, 0.0034)], segs=4), 'Y', AP_Y - 0.002, AP_Y + 0.002)
    flat = prism(fillet([(-0.0044, 0.0105, 0.002), (0.0044, 0.0105, 0.002), (0.0044, AP_Y - 0.002), (-0.0044, AP_Y - 0.002)], segs=3), 'Z', 0.0553, 0.0585)
    k.add('m16_aperture', join(leaf, flat), 'park', bevel=(0.0003, 2),
          cut=[cyl(0.0031, 0.02, 40, at=(0, AP_Y, SIGHT_Z)), cyl(0.0009, 0.01, 16, axis='Z', at=(0, 0.0175, 0.057))])


# ----------------------------------------------------------------------------- lower receiver

def lower(k):
    prof = fillet([(-0.016, UP_B, 0.001), (0.1695, UP_B, 0.001), (0.1695, -0.026, 0.002), (0.1665, -0.030, 0.001), (0.1665, -0.060, 0.002),
                   (0.1705, -0.0705, 0.002), (0.1695, -0.0765, 0.0012), (0.0965, -0.0765, 0.0012), (0.0955, -0.060, 0.002), (0.090, -0.050, 0.003),
                   (0.083, -0.046, 0.002), (-0.024, -0.046, 0.002), (-0.030, -0.040, 0.004), (-0.030, -0.026, 0.004), (-0.022, -0.0195, 0.002)], segs=3)
    body = prism(prof, 'X', -0.01425, 0.01425)
    flare = prism(fillet([(0.1665, -0.031, 0.001), (0.0962, -0.031, 0.001), (0.0962, -0.0765, 0.0012), (0.1695, -0.0765, 0.0012),
                          (0.1705, -0.0705, 0.002), (0.1665, -0.060, 0.002)], segs=2), 'X', -0.0164, 0.0164)
    tower = cyl(0.0160, 0.0155, 48, at=(0, -0.00825, 0))
    fence = span_box(0.0140, 0.0172, 0.0795, 0.0990, -0.0440, -0.0230)
    bc_boss = span_box(-0.0156, -0.0140, 0.0770, 0.0950, -0.0300, -0.0120)
    front_ears = prism(fillet([(0.1515, UP_B - 0.001), (0.1695, UP_B - 0.001), (0.1695, -0.0070, 0.004), (0.1590, -0.0070, 0.004)], segs=3), 'X', -0.0150, 0.0150)
    rear_ears = prism(fillet([(-0.016, UP_B - 0.001), (0.0045, UP_B - 0.001), (0.0045, -0.0050, 0.003), (-0.016, -0.0050)], segs=3), 'X', -0.0150, 0.0150)
    cuts = [
        span_box(-0.0121, 0.0121, 0.0990, 0.1660, -0.090, -0.020),       # magazine well
        span_box(-0.0046, 0.0046, 0.034, 0.072, -0.052, -0.030),         # trigger slot
        cyl(0.0057, 0.01, 28, axis='X', at=(0.0176, 0.0893, -0.0335)),   # mag release recess inside the fence
    ]
    k.add('m16_lower', body, 'anod', bevel=(0.0006, 2), union=[flare, tower, fence, bc_boss, front_ears, rear_ears], cut=cuts)

    k.add('m16_magRelease', cyl(0.0046, 0.0035, 28, axis='X', at=(0.01605, 0.0893, -0.0335)), 'park', bevel=(0.0004, 2))
    # bolt catch (left): lever with serrated upper pad
    bc = prism(fillet([(0.0785, -0.0295, 0.001), (0.0935, -0.0282, 0.001), (0.0935, -0.0148, 0.002), (0.0800, -0.0148, 0.002)], segs=2), 'X', -0.0170, -0.0152)
    ridges = [span_box(-0.0174, -0.0165, 0.0805 + i * 0.0026, 0.0817 + i * 0.0026, -0.0205, -0.0152) for i in range(5)]
    k.add('m16_boltCatch', join(bc, *ridges), 'park', bevel=(0.00025, 1))
    # pins: takedown / pivot (heads on the left), hammer / trigger (flush both sides)
    pins = []
    for y, z, r, head in ((-0.009, -0.0105, 0.0030, True), (0.1635, -0.0115, 0.0030, True), (0.0505, -0.0355, 0.0022, False), (0.0285, -0.0290, 0.0022, False)):
        if head:
            pins.append(lathe([(0, -0.0162), (r * 0.72, -0.0162), (r, -0.0157), (r * 1.08, -0.0150), (r * 1.08, -0.0140), (0, -0.0140)], 24, axis='X', center=(y, z)))
            pins.append(lathe([(0, 0.0140), (r * 0.8, 0.0140), (r * 0.8, 0.0152), (r * 0.62, 0.0155), (0, 0.0155)], 20, axis='X', center=(y, z)))
        else:
            for s in (-1, 1):
                pins.append(lathe([(0, s * 0.0140), (r, s * 0.0140), (r, s * 0.0146), (r * 0.8, s * 0.0149), (0, s * 0.0149)], 18, axis='X', center=(y, z)))
    k.add('m16_pins', join(*pins), 'steel', bevel=(0.0002, 1))
    # selector at BURST (lever points to the rear) + detent end on the right
    disc = lathe([(0, -0.0158), (0.0055, -0.0158), (0.0059, -0.0153), (0.0059, -0.0142), (0, -0.0142)], 32, axis='X', center=(0.0105, -0.030))
    lever = prism(fillet([(0.0120, -0.0335, 0.002), (0.0120, -0.0262, 0.002), (-0.0048, -0.0282, 0.0025), (-0.0058, -0.0302, 0.0015), (-0.0048, -0.0318, 0.002)], segs=3),
                  'X', -0.0166, -0.0154)
    rib = span_box(-0.0170, -0.0164, -0.0035, 0.0075, -0.0305, -0.0293)
    detent = lathe([(0, 0.0140), (0.0033, 0.0140), (0.0033, 0.0148), (0, 0.0148)], 18, axis='X', center=(0.0105, -0.030))
    k.add('m16_selector', join(disc, lever, rib, detent), 'park', bevel=(0.00025, 1))
    # engraved markings (left side)
    marks = []
    for txt, y, z, size in (('SAFE', 0.0215, -0.0300, 0.0021), ('SEMI', 0.0105, -0.0205, 0.0021), ('BURST', -0.0010, -0.0392, 0.0021),
                            ('PROPERTY OF U.S. GOVT.', 0.1330, -0.0405, 0.0024), ('M16A2', 0.1330, -0.0465, 0.0034),
                            ('CAL 5.56 MM', 0.1330, -0.0525, 0.0024), ('No 7310954', 0.1330, -0.0575, 0.0024)):
        x = -0.01425 if y < 0.09 else -0.0164
        marks.append(xform(text_mesh(txt, size), at=(x - 0.00002, y, z), rot=TEXT_LEFT))
    k.add('m16_markings', join(*marks), 'engrave', smooth=0)


def grip_and_guard(k):
    front = [(-0.006, -0.020), (0.012, -0.0195), (0.028, -0.0225), (0.041, -0.0185), (0.057, -0.0205), (0.083, -0.019), (0.099, -0.0165, 0.006)]
    rear = [(0.099, 0.0158, 0.006), (0.082, 0.0185), (0.045, 0.0182), (0.018, 0.0205), (0.002, 0.0245), (-0.006, 0.024)]
    outline = fillet([(*gp(u, v), p[2] if len(p) > 2 else 0.0025) for p in front + rear for u, v in [p[:2]]], segs=4)
    grip = prism(outline, 'X', -0.0141, 0.0141)
    by, bz = gp(0.097, 0.0)
    hole = xform(cyl(0.0068, 0.024, 32, axis='Z'), rot=(-GA, 0, 0))
    xform(hole, at=(0, by, bz))
    k.add('m16_grip', grip, 'grip', bevel=(0.0064, 5, 40), cut=[hole])
    guard = prism(fillet([(0.0935, -0.044, 0.001), (0.0865, -0.044, 0.001), (0.0865, -0.0635, 0.003), (0.026, -0.0635, 0.004), (0.0145, -0.050, 0.003),
                          (0.0125, -0.0445, 0.001), (0.0065, -0.0445, 0.001), (0.0085, -0.052, 0.004), (0.0215, -0.0705, 0.005), (0.0885, -0.0705, 0.003),
                          (0.0935, -0.066, 0.002)], segs=3), 'X', -0.00625, 0.00625)
    k.add('m16_triggerGuard', guard, 'anod', bevel=(0.0010, 2))
    k.add('m16_guardPin', cyl(0.0013, 0.0296, 14, axis='X', at=(0, 0.0905, -0.0465)), 'steel', bevel=(0.0002, 1))


# ----------------------------------------------------------------------------- A2 fixed stock

def stock(k):
    stations = [  # y, half width, top, bottom, corner radius
        (-0.0160, 0.0156, 0.0166, -0.0300, 0.0100),
        (-0.0240, 0.0160, 0.0168, -0.0336, 0.0100),
        (-0.0600, 0.0170, 0.0170, -0.0480, 0.0110),
        (-0.1100, 0.0181, 0.0171, -0.0650, 0.0120),
        (-0.1700, 0.0193, 0.0174, -0.0845, 0.0125),
        (-0.2300, 0.0204, 0.0179, -0.1040, 0.0125),
        (-0.2700, 0.0211, 0.0184, -0.1165, 0.0115),
        (-0.2890, 0.0214, 0.0188, -0.1215, 0.0090),
    ]
    rings = [ring_y(rrect(-hw, bot, hw, top, r, segs=6), y) for y, hw, top, bot, r in stations]
    k.add('m16_stock', loft(rings), 'poly', bevel=(0.0015, 2), smooth=40)
    # buttplate: serrated face, trapdoor, sling swivel
    plate = prism(rrect(-0.0218, -0.1222, 0.0218, 0.0194, 0.0092, segs=6), 'Y', -0.3010, -0.2885)
    grooves = []
    for i in range(30):
        z = -0.1165 + i * 0.0045
        if z > 0.0150:
            break
        if -0.0985 < z < -0.0335:
            for a, b in ((-0.03, -0.0132), (0.0132, 0.03)):
                grooves.append(span_box(a, b, -0.3030, -0.3000, z - 0.0008, z + 0.0008))
        else:
            grooves.append(span_box(-0.03, 0.03, -0.3030, -0.3000, z - 0.0008, z + 0.0008))
    door = [span_box(-0.0126, 0.0126, -0.3030, -0.2998, -0.0990, -0.0982), span_box(-0.0126, 0.0126, -0.3030, -0.2998, -0.0338, -0.0330),
            span_box(-0.0126, -0.0118, -0.3030, -0.2998, -0.0990, -0.0330), span_box(0.0118, 0.0126, -0.3030, -0.2998, -0.0990, -0.0330)]
    k.add('m16_buttplate', plate, 'park', bevel=(0.0010, 2), cut=grooves + door)
    tab = span_box(-0.004, 0.004, -0.3018, -0.3005, -0.0975, -0.0935)
    k.add('m16_trapdoorTab', tab, 'park', bevel=(0.0003, 1))
    bracket = span_box(-0.0045, 0.0045, -0.2990, -0.2860, -0.1265, -0.1180)
    rivet = cyl(0.0017, 0.0120, 14, axis='X', at=(0, -0.2925, -0.1240))
    loop = torus(0.0082, 0.0013, 32, 8, normal='X', at=(0, -0.2925, -0.1318))
    k.add('m16_rearSwivel', join(bracket, rivet, loop), 'park', bevel=(0.0003, 1))


# ----------------------------------------------------------------------------- barrel, handguard, front sight

def front_end(k):
    # delta ring (knurled grip band) and handguard cap
    k.add('m16_deltaRing', lathe([(0.0100, 0.1765), (0.0236, 0.1765), (0.0256, 0.1785, 1), (0.0256, 0.1875, 1), (0.0259, 0.1885), (0.0259, 0.1935),
                                  (0.0246, 0.1990), (0.0226, 0.1990), (0.0226, 0.1945), (0.0100, 0.1945), (0.0100, 0.1765)], 96, mod=knurl(48, 0.03)),
          'park', bevel=(0.0003, 1))
    k.add('m16_handguardCap', lathe([(0.0086, 0.4925), (0.0226, 0.4925), (0.0226, 0.4875), (0.0243, 0.4875), (0.0243, 0.4985), (0.0232, 0.5015),
                                     (0.0200, 0.5035), (0.0086, 0.5035), (0.0086, 0.4925)], 64), 'park', bevel=(0.0004, 2))
    # A2 round ribbed handguard with vents; heat shield behind
    def ribs(a):
        c = math.cos(24 * a)
        rib = 1 / (1 + math.exp(-c * 6))  # flat-topped ribs
        split = math.exp(-((math.sin(a) / 0.035) ** 2))  # parting line at the sides
        return 0.036 * rib - 0.05 * split
    hg = lathe([(0.0180, 0.1940), (0.0222, 0.1940), (0.0222, 0.1990), (0.0228, 0.2040, 1), (0.0228, 0.4800, 1), (0.0222, 0.4860),
                (0.0222, 0.4925), (0.0180, 0.4925), (0.0180, 0.1940)], 192, mod=ribs)
    vents = []
    for row in (58, 122, 238, 302):
        a = row * DEG
        for i in range(6):
            y = 0.232 + i * 0.043
            v = cyl(0.0030, 0.02, 20, axis='X')
            xform(v, rot=(0, -a, 0))
            xform(v, at=(math.cos(a) * 0.021, y, math.sin(a) * 0.021))
            vents.append(v)
    k.add('m16_handguard', hg, 'poly', bevel=(0.0004, 1), cut=vents, smooth=45)
    k.add('m16_heatShield', lathe([(0.0168, 0.200), (0.0176, 0.200), (0.0176, 0.486), (0.0168, 0.486), (0.0168, 0.200)], 64), 'greyAl')
    # barrel: government profile, crown with bore
    k.add('m16_barrel', lathe([(0, 0.176), (0.0082, 0.176), (0.0082, 0.5050), (0.0095, 0.5055), (0.0095, 0.5450), (0.0093, 0.5460),
                               (0.0093, 0.6425), (0.0086, 0.6435), (0.0072, 0.6440), (0.0072, 0.6490), (0.0030, 0.6490), (0.0029, 0.6400), (0, 0.6400)], 48),
          'park', bevel=(0.0003, 1))
    k.add('m16_bore', cyl(0.0029, 0.004, 20, at=(0, 0.6405, 0)), 'hole')
    k.add('m16_gasTube', join(cyl(0.0024, 0.330, 16, at=(0, 0.345, 0.0128)), cyl(0.0024, 0.02, 16, at=(0, 0.1785, 0.0128))), 'steelDark')
    # front sight base: collar + tower + protective ears + bayonet lug + swivel boss
    collar = lathe([(0.0095, 0.5050), (0.0124, 0.5050), (0.0131, 0.5062), (0.0131, 0.5438), (0.0124, 0.5450), (0.0095, 0.5450), (0.0095, 0.5050)], 48)
    tower = prism(fillet([(0.5065, 0.0100), (0.5435, 0.0100), (0.5400, 0.0310, 0.002), (0.5100, 0.0310, 0.002)], segs=3), 'X', -0.0094, 0.0094)
    ears = [prism(fillet([(0.5105, 0.0290), (0.5395, 0.0290), (0.5285, 0.0668, 0.0018), (0.5215, 0.0668, 0.0018)], segs=3), 'X', a, b)
            for a, b in ((-0.0093, -0.0049), (0.0049, 0.0093))]
    lug = prism(fillet([(0.5160, -0.0110), (0.5410, -0.0110), (0.5410, -0.0205, 0.002), (0.5375, -0.0255, 0.003), (0.5160, -0.0255, 0.002)], segs=3),
                'X', -0.0042, 0.0042)
    boss = prism(fillet([(0.5058, -0.0100), (0.5150, -0.0100), (0.5150, -0.0230, 0.002), (0.5058, -0.0230, 0.002)], segs=2), 'X', -0.0046, 0.0046)
    k.add('m16_fsb', collar, 'park', bevel=(0.0005, 2), union=[tower, *ears, lug, boss],
          cut=[cyl(0.0095, 0.05, 48, at=(0, 0.525, 0)), cyl(0.0021, 0.03, 16, axis='Z', at=(0, 0.525, 0.035)),
               cyl(0.0012, 0.02, 12, axis='Z', at=(0, 0.5305, 0.035))])
    # square post with taper + detent plunger, taper pins, sling swivel
    post = hull([(x, y, z) for x in (-0.0009, 0.0009) for y in (0.5241, 0.5259) for z in (0.0300, 0.0625)] + [(0, 0.5250, SIGHT_Z)])
    thread = cyl(0.0021, 0.0065, 16, axis='Z', at=(0, 0.525, 0.0325))
    k.add('m16_frontPost', join(post, thread), 'park', smooth=20)
    k.add('m16_detent', cyl(0.0011, 0.0035, 12, axis='Z', at=(0, 0.5305, 0.0318)), 'steel')
    tpins = [lathe([(0, s * 0.0129), (0.0014, s * 0.0129), (0.0014, s * 0.0133), (0, s * 0.0133)], 14, axis='X', center=(y, 0.0035))
             for s in (-1, 1) for y in (0.5115, 0.5385)]
    k.add('m16_taperPins', join(*tpins), 'steel')
    rivet = cyl(0.0017, 0.0114, 14, axis='X', at=(0, 0.5104, -0.0190))
    loop = torus(0.0070, 0.0012, 32, 8, normal='X', at=(0, 0.5104, -0.0265))
    k.add('m16_frontSwivel', join(rivet, loop), 'park', bevel=(0.0002, 1))
    # A2 birdcage: closed bottom, five slots, wrench flats
    fh = lathe([(0.0072, 0.6465), (0.0110, 0.6465), (0.0112, 0.6475), (0.0112, 0.7010), (0.0106, 0.7055), (0.0080, 0.7055),
                (0.0080, 0.6600), (0.0072, 0.6590), (0.0072, 0.6465)], 72)
    slots = []
    for ang in (90, 30, 150, -30, 210):
        th = ang * DEG
        s = prism(rrect(-0.00135, 0.6610, 0.00135, 0.6975, 0.00134, segs=4), 'Z', 0.006, 0.016)
        xform(s, rot=(0, math.pi / 2 - th, 0))
        slots.append(s)
    flats = [span_box(0.0098, 0.02, 0.6450, 0.6570, -0.02, 0.02), span_box(-0.02, -0.0098, 0.6450, 0.6570, -0.02, 0.02)]
    k.add('m16_flashHider', fh, 'park', bevel=(0.0003, 1), cut=slots + flats)


# ----------------------------------------------------------------------------- moving parts

def moving_parts(k):
    bolt = k.part('bolt', (0, 0, 0))
    carrier = lathe([(0, 0.0120), (0.0122, 0.0120), (0.0122, 0.1075), (0.0108, 0.1095), (0.0094, 0.1095), (0.0094, 0.1245), (0.0086, 0.1262), (0, 0.1262)], 48)
    notches = [span_box(0.0108, 0.0140, 0.0560 + i * 0.0040, 0.0576 + i * 0.0040, -0.0010, 0.0060) for i in range(10)]
    k.add('m16_carrier', carrier, 'steelDark', bevel=(0.0003, 1), cut=notches, parent=bolt)
    k.add('m16_extractor', span_box(0.0078, 0.0098, 0.1095, 0.1240, 0.0020, 0.0060), 'steelDark', bevel=(0.0002, 1), parent=bolt)
    k.add('m16_gasKey', span_box(-0.0035, 0.0035, 0.0180, 0.0600, 0.0110, 0.0158), 'steelDark', bevel=(0.0004, 1), parent=bolt)

    ch = k.part('chargingHandle', (0, 0, 0.0202))
    P = 0.0202
    pieces = [
        hull([(x, y, P + z) for x in (-0.0068, 0.0068) for y in (-0.0155, -0.0005) for z in (-0.0033, 0.0033)]),
        hull([(x, y, P + z) for y, xs in ((-0.004, (-0.0245, -0.006)), (-0.0152, (-0.0262, -0.006))) for x in xs for z in (-0.003, 0.0031)]),
        hull([(x, y, P + z) for y, xs in ((-0.004, (0.006, 0.0225)), (-0.0152, (0.006, 0.0240))) for x in xs for z in (-0.003, 0.0031)]),
        hull([(x, y, P + z) for y, xs, zs in ((-0.006, (-0.0235, -0.012), (0.003, 0.0052)), (-0.0135, (-0.0248, -0.012), (0.003, 0.0048))) for x in xs for z in zs]),
        span_box(-0.0045, 0.0045, -0.001, 0.049, P - 0.002, P + 0.002),
    ]
    k.add('m16_chargingHandle', join(*pieces), 'anod', bevel=(0.0006, 2), parent=ch)

    trig = k.part('trigger', (0, 0.0505, -0.0355))
    tp = [(-0.0042, 0.0035, 0.001), (0.0035, 0.0035, 0.001), (0.0052, -0.009), (0.0078, -0.0185), (0.0098, -0.0245, 0.001), (0.0086, -0.0268, 0.001),
          (0.0056, -0.0238), (0.0022, -0.0155), (-0.0022, -0.006)]
    k.add('m16_trigger', prism(fillet([(0.0505 + y, -0.0355 + z, *r) for y, z, *r in tp], segs=2), 'X', -0.0031, 0.0031), 'park',
          bevel=(0.0008, 2), parent=trig)


def magazine(k):
    mag = k.part('mag', MAG_PIVOT)
    oy, oz = MAG_PIVOT[1], MAG_PIVOT[2]

    def f(h):
        return 0.0 if h >= -0.015 else 0.035 * ((-0.015 - h) / 0.095) ** 1.5

    def fd(h):
        return 0.0 if h >= -0.015 else -0.035 * 1.5 * ((-0.015 - h) / 0.095) ** 0.5 / 0.095

    def outline(h0, h1, hf, hr, n=18):
        front, rear = [], []
        for i in range(n + 1):
            h = h0 + (h1 - h0) * i / n
            d = fd(h)
            ln = math.hypot(1, d)
            ny, nz = 1 / ln, -d / ln
            c = (f(h), h)
            front.append((oy + c[0] + hf * ny, oz + c[1] + hf * nz))
            rear.append((oy + c[0] - hr * ny, oz + c[1] - hr * nz))
        return front + rear[::-1]

    body = prism(outline(0.056, -0.110, 0.0315, 0.0315), 'X', -0.0112, 0.0112)
    panel = prism(outline(0.042, -0.098, 0.0225, 0.025), 'X', -0.0119, 0.0119)
    spine = prism(outline(0.050, -0.104, 0.0330, -0.0300, 16), 'X', -0.0060, 0.0060)
    yb = -0.110
    ang = math.atan(-fd(yb))
    plate = box(0.0262, 0.0695, 0.0052, at=(0, oy + f(yb) + 0.0015, oz + yb - 0.0006), rot=(ang, 0, 0))
    lips = [span_box(a, b, oy - 0.026, oy + 0.026, oz + 0.054, oz + 0.0605) for a, b in ((0.0078, 0.0112), (-0.0112, -0.0078))]
    k.add('m16_magBody', body, 'anod', bevel=(0.0010, 2), union=[panel, spine, plate, *lips], parent=mag)
    # two rounds of M855 (green tip) under the feed lips
    for i, (x, h) in enumerate(((0.0028, 0.0612), (-0.0028, 0.0540))):
        at = (x, oy - 0.027, oz + h)
        R, rim, neck = 0.00475, 0.00478, 0.00315
        case = lathe([(0, 0), (rim * 0.96, 0), (rim, 0.0003), (rim, 0.0010), (R * 0.84, 0.0013), (R * 0.84, 0.0025), (R, 0.0029),
                      (R * 0.975, 0.036), (neck, 0.036 + (R - neck) * 1.4), (neck, 0.0449), (0, 0.0449)], 24)
        bullet = lathe([(0, 0.0400), (0.00285, 0.0400), (0.00285, 0.0520)] + [(0.00285 * max(0.0, 1 - (t / 6) ** 1.7) ** 0.62, 0.0520 + 0.0100 * t / 6) for t in range(1, 5)] +
                       [(0, 0.0520 + 0.0100 * 4 / 6)], 24)
        tip = lathe([(0.00285 * max(0.0, 1 - (4 / 6) ** 1.7) ** 0.62 + 0.00002, 0.0520 + 0.0100 * 4 / 6)] +
                    [(0.00285 * max(0.0, 1 - (t / 6) ** 1.7) ** 0.62, 0.0520 + 0.0100 * t / 6) for t in (5,)] + [(0.00035, 0.0620), (0, 0.0621)], 24)
        for b in (case, bullet, tip):
            xform(b, at=at)
        k.add(f'm16_round{i}Case', case, 'brass', parent=mag, smooth=40)
        k.add(f'm16_round{i}Bullet', bullet, 'copper', parent=mag, smooth=50)
        k.add(f'm16_round{i}Tip', tip, 'greenTip', parent=mag, smooth=50)


def markers(k):
    k.marker('web', (0, -0.031, -0.047))
    k.marker('muzzle', (0, 0.7060, 0))
    k.marker('ejectPort', (0.016, 0.076, 0.001))
    ry, rz = gp(0.006, 0)
    k.marker('rightHand', (0, ry, rz))
    k.marker('leftHand', (0, 0.335, 0.001))
    k.marker('rearSight', (0, AP_Y, SIGHT_Z))
    k.marker('frontSight', (0, 0.525, SIGHT_Z))
