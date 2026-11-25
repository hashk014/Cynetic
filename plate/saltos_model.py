"""Original conservative solver for baking the Saltos reference motion."""
import math
import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import root

BPM, DURATION = 124, 35
FLOOR, TOP = 1017., 959.
START, END = 216., 864.
LEFT_WALL, RIGHT_WALL = 86., 994.
RADIUS, ECCENTRIC = 86., 32.
LENGTH_1, LENGTH_2 = 179., 167.
DISK_HOME = 548.
PLATE, DISK, FIRST, LAST = 6.7, 2.05, 1.15, .88
GRAVITY = 192.*9.81
STIFFNESS = 196.
FILL = 210
REFERENCE_BEATS = 2
FIRST_FLIP_APEX = 3.2
FLIP_STATE = np.array((-25.41534893000175, -.6128421568031241, -.04536354008355148, math.pi,
                       -45.12842729507648, -.611507583972771, -3.2348335293282453, -6.2807022871909775))


def pose(q):
    offset, spin, a, b = q
    centre = np.array((DISK_HOME + offset + RADIUS*spin, TOP-RADIUS))
    pin = centre + ECCENTRIC*np.array((-math.sin(spin), math.cos(spin)))
    elbow = pin + LENGTH_1*np.array((math.sin(a), math.cos(a)))
    tip = elbow + LENGTH_2*np.array((math.sin(b), math.cos(b)))
    return centre, pin, elbow, tip


def equation(_, state, scale=1.):
    x, spin, a, b, _, omega, da, db = state
    spin_jac = np.array(((1.,RADIUS,0.,0.), (0.,0.,0.,0.)))
    joint_jac = spin_jac.copy()
    joint_jac[:,1] += (-ECCENTRIC*math.cos(spin), -ECCENTRIC*math.sin(spin))
    elbow_jac = joint_jac.copy()
    elbow_jac[:,2] = (LENGTH_1*math.cos(a), -LENGTH_1*math.sin(a))
    tip_jac = elbow_jac.copy()
    tip_jac[:,3] = (LENGTH_2*math.cos(b), -LENGTH_2*math.sin(b))

    joint_bias = -ECCENTRIC*omega**2*np.array((-math.sin(spin), math.cos(spin)))
    elbow_bias = joint_bias - LENGTH_1*da**2*np.array((math.sin(a), math.cos(a)))
    tip_bias = elbow_bias - LENGTH_2*db**2*np.array((math.sin(b), math.cos(b)))
    inertia = np.diag((PLATE, .5*DISK*RADIUS**2, 0., 0.))
    force = np.array((-scale*STIFFNESS*x, 0., 0., 0.))
    gravity = np.array((0., scale*GRAVITY))
    for mass, jac, bias in ((DISK,spin_jac,np.zeros(2)), (FIRST,elbow_jac,elbow_bias), (LAST,tip_jac,tip_bias)):
        inertia += mass * jac.T@jac
        force += mass * jac.T@(gravity-bias)
    return np.r_[state[4:],np.linalg.solve(inertia, force)]


def periodic_motion():
    # Find the nonlinear mode in which the two pendulum links swing in opposition.
    # A second simultaneous turning point closes a reversible conservative orbit.
    amplitude = 1.03
    guess = (-8.295, .500, -1.032, amplitude, .941)

    def stop(parameters):
        state = np.r_[parameters[:4], np.zeros(4)]
        solution = solve_ivp(equation, (0, parameters[4]), state, method='DOP853', rtol=1e-10, atol=1e-11)
        return np.r_[solution.y[4:,-1] * (.014, 1, 1, 1), parameters[3] - amplitude]

    adjusted = root(stop, guess, tol=1e-9)
    if not adjusted.success or np.linalg.norm(adjusted.fun) > 1e-8:
        raise RuntimeError('Le mode périodique du double pendule ne converge pas')
    period = 2 * adjusted.x[4]
    initial = np.r_[adjusted.x[:4], np.zeros(4)]
    cycle = solve_ivp(equation, (0, period), initial, dense_output=True,
                      method='DOP853', rtol=2e-12, atol=2e-13, max_step=1/140)
    if not cycle.success or np.max(np.abs(cycle.y[:,-1]-initial)) > 1e-6:
        raise RuntimeError('Raccord mécanique du cycle imprécis')
    return period, cycle.sol
