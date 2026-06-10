#!/usr/bin/env python3
"""Build jamb-physics-decade.jsonl from extracted edupadi.com questions.

Data was harvested via firecrawl_extract against year-tagged edupadi.com pages
(https://edupadi.com/classroom/lessons/jamb/physics/<YEAR>/page/<N>).
Each record below is transcribed from genuine questions on those pages.
Year is attributed from the page the questions came from.
"""
import json
import re
import unicodedata

OUT = "/Users/mitchellagoma/Documents/exam-prep-agent/data/scraped/jamb-physics-decade.jsonl"

# Each entry: (year, source_url, [questions...])
# Question dict: text, options{A,B,C,D}, answer, explanation, topic
DATA = []

def add(year, url, questions):
    DATA.append((year, url, questions))

# ---------------- 2016 (edupadi page 1) ----------------
add(2016, "https://edupadi.com/classroom/lessons/jamb/physics/2016/page/1", [
  {"text": "Myopic defects in the human eye can be corrected through the use of a",
   "options": {"A": "Concave Mirror", "B": "Concave lens", "C": "Prism", "D": "Convex lens"},
   "answer": "B", "explanation": "", "topic": "light and optics"},
  {"text": "A charged particle is moving in a uniform magnetic field. If the direction of motion of the charged particle is parallel to the magnetic field, the path of the charge will",
   "options": {"A": "Be a straight line", "B": "Curve inwards", "C": "Be a parabola", "D": "Curve outwards"},
   "answer": "A", "explanation": "", "topic": "magnetic field"},
  {"text": "What happens to a water pool on a day when the humidity of the air is very low?",
   "options": {"A": "Temperature decreases", "B": "Slow evaporation", "C": "Temperature increases", "D": "Rapid evaporation"},
   "answer": "D", "explanation": "", "topic": "evaporation and boiling"},
  {"text": "A satellite moves in a circular orbit of radius 4R round the earth. The acceleration of the satellite in terms of g is",
   "options": {"A": "g/16", "B": "g/4", "C": "4g", "D": "16g"},
   "answer": "A", "explanation": "a = g(R/r)^2 = g(R/4R)^2 = g/16", "topic": "gravitational field"},
  {"text": "I. Chemical  II. Sound  III. Electricity. Which of the above forms of energy can directly be converted to light energy?",
   "options": {"A": "I and II only", "B": "II and III only", "C": "I, II and III", "D": "I and III only"},
   "answer": "D", "explanation": "", "topic": "energy and power"},
  {"text": "If the distance between the object and the pinhole of a pinhole camera is reduced by half, the size of the image of the object",
   "options": {"A": "Is quadrupled", "B": "Is halved", "C": "Remains the same", "D": "Is double"},
   "answer": "D", "explanation": "", "topic": "light and optics"},
  {"text": "An object is placed 15cm in front of a plane mirror. If the mirror is moved further 5cm away from the object, the distance between the object and its image is",
   "options": {"A": "80cm", "B": "40cm", "C": "50cm", "D": "70cm"},
   "answer": "B", "explanation": "New object-mirror distance = 15 + 5 = 20cm; image is same distance behind mirror, so object-to-image = 2 x 20 = 40cm", "topic": "reflection of light"},
  {"text": "Which of the following statements is correct about a machine?",
   "options": {"A": "Efficiency of a machine is always greater than 1", "B": "Efficiency decreases with an increase in friction", "C": "Velocity ratio depends on friction", "D": "Mechanical advantage increases with an increase in friction"},
   "answer": "B", "explanation": "", "topic": "simple machine"},
  {"text": "The instrument used to view stars is the",
   "options": {"A": "Prism binoculars", "B": "Telescope", "C": "Film projector", "D": "Microscope"},
   "answer": "B", "explanation": "", "topic": "application of lens"},
  {"text": "What is the angular magnification of a telescope having objective and eyepiece lenses of focal lengths 30cm and 3cm respectively?",
   "options": {"A": "60", "B": "10", "C": "30", "D": "90"},
   "answer": "B", "explanation": "M = fo/fe = 30/3 = 10", "topic": "application of lens"},
])

# ---------------- 2017 (edupadi page 1) ----------------
add(2017, "https://edupadi.com/classroom/lessons/jamb/physics/2017/page/1", [
  {"text": "Calculate the upthrust on an object of volume 50cm3 which is immersed in liquid of density 10^3 kgm-3 [g = 10ms-2]",
   "options": {"A": "0.8N", "B": "2.5N", "C": "0.5N", "D": "1.0N"},
   "answer": "C", "explanation": "Mass of liquid displaced = density x volume = 10^3 x 50 x 10^-6 = 0.05kg; Upthrust = mg = 0.05 x 10 = 0.5N", "topic": "density and relative density"},
  {"text": "Under what conditions are cathode rays produced in a discharge tube?",
   "options": {"A": "High pressure and low voltage", "B": "High pressure and high voltage", "C": "Low pressure and low voltage", "D": "Low pressure and high voltage"},
   "answer": "D", "explanation": "Cathode rays are produced in a discharge tube under low pressure and high voltage", "topic": "electrical conduction through liquids and gases"},
  {"text": "Under which of the following conditions is work done?",
   "options": {"A": "A man supports a heavy load above his head with his hands", "B": "A boy climbs onto a table", "C": "A man pushes against a wall", "D": "A woman holds a pot of water"},
   "answer": "B", "explanation": "For work to be done, distance must be moved in the direction of the force, because work done = force x distance", "topic": "work/energy/power"},
  {"text": "Calculate the specific latent heat of vaporization of steam if 1.13 x 10^6 J of heat energy is required to convert 15kg of it to water.",
   "options": {"A": "7.53 x 10^5 Jkg-1", "B": "7.53 x 10^-2 Jkg-1", "C": "7.53 x 10^4 Jkg-1", "D": "7.53 x 10^-3 Jkg-1"},
   "answer": "C", "explanation": "E = mL, so L = E/m = 1.13 x 10^6 / 15 = 7.53 x 10^4 Jkg-1", "topic": "measurement of heat energy"},
  {"text": "A cell of internal resistance 2 ohms supplies current to a 6 ohm resistor. The efficiency of the cell is",
   "options": {"A": "12.0%", "B": "25.0%", "C": "33.3%", "D": "75.0%"},
   "answer": "D", "explanation": "Efficiency = R/(R+r) x 100 = 6/(6+2) x 100 = 75.0%", "topic": "current electricity"},
  {"text": "Which of the following statements is NOT correct?",
   "options": {"A": "Molecules of a liquid are stationary", "B": "Brownian motion is an evidence of particle nature of matter", "C": "Matter is made up of molecules", "D": "The molecules of matter are in constant motion"},
   "answer": "A", "explanation": "Molecules of a liquid are not stationary; they are in constant random motion", "topic": "simple structure of matter"},
  {"text": "Which is the incorrect formula for a body accelerating uniformly?",
   "options": {"A": "a = (v^2 - u^2)/2", "B": "v^2 = u^2 + 2as", "C": "s = (1/2)ut + at^2", "D": "v^2 - u^2 = 2as"},
   "answer": "C", "explanation": "The correct equation is s = ut + (1/2)at^2", "topic": "equation of motion/motion under gravity"},
  {"text": "Which of the following is not an electromagnetic radiation?",
   "options": {"A": "x-ray", "B": "Radio waves", "C": "sunlight", "D": "sound waves"},
   "answer": "D", "explanation": "Electromagnetic waves do not require any material medium, but sound waves are mechanical waves that require a material medium", "topic": "waves"},
  {"text": "Calculate the electric field intensity between two plates of potential difference 6.5V when separated by a distance of 35cm.",
   "options": {"A": "18.57 NC-1", "B": "53.06 NC-1", "C": "2.28 NC-1", "D": "0.80 NC-1"},
   "answer": "A", "explanation": "E = V/d = 6.5 / (35 x 10^-2) = 18.57 NC-1", "topic": "electric field"},
  {"text": "Why do soldiers march disorderly while crossing a bridge?",
   "options": {"A": "To prevent resonance on the bridge", "B": "To set the bridge into resonance", "C": "To make the bridge collapse", "D": "To spread their weight evenly on the bridge"},
   "answer": "A", "explanation": "Marching in step could set the bridge into resonance; at resonance the oscillation amplitude builds to a peak the bridge cannot sustain and it collapses. Marching out of step prevents this.", "topic": "waves"},
])

# ---------------- 2019 (edupadi page 1) ----------------
add(2019, "https://edupadi.com/classroom/lessons/jamb/physics/2019/page/1", [
  {"text": "The limiting frictional force between two surfaces depends on: I. the normal reaction between the surfaces  II. the area of surface in contact  III. the relative velocity between the surfaces  IV. the nature of the surface",
   "options": {"A": "I only", "B": "I & IV only", "C": "II only", "D": "III only"},
   "answer": "B", "explanation": "Solid friction depends on the normal reaction (weight pressing the surfaces together) and the nature of the surfaces in contact.", "topic": "friction"},
  {"text": "If a body moves with a constant speed and at the same time undergoes an acceleration, its motion is said to be",
   "options": {"A": "oscillation", "B": "circular", "C": "rotational", "D": "rectilinear"},
   "answer": "B", "explanation": "An object moving in a circle at constant speed is still accelerating because its direction (and hence velocity) keeps changing.", "topic": "motion/force/circular motion"},
  {"text": "When blue and green colours of light are mixed, the resultant colour is",
   "options": {"A": "cyan", "B": "magenta", "C": "black", "D": "yellow"},
   "answer": "A", "explanation": "In additive colour mixing, green + blue light gives cyan.", "topic": "light and optics"},
  {"text": "A metal rod has a length of 100cm at 200 degrees C. At what temperature will its length be 99.4cm if the linear expansivity of the material of the rod is 2 x 10^-5 C^-1?",
   "options": {"A": "200 degrees C", "B": "300 degrees C", "C": "100 degrees C", "D": "-100 degrees C"},
   "answer": "D", "explanation": "alpha = (L2 - L1)/(L1(T2 - T1)). Solving 2 x 10^-5 = (99.4 - 100)/(100(T2 - 200)) gives T2 = -100 degrees C", "topic": "heat and temperature"},
  {"text": "According to the kinetic molecular model, in gases",
   "options": {"A": "the molecules are very far apart and occupy all the space made available", "B": "the particles vibrate about fixed positions and are held together by strong intermolecular bonds", "C": "the particles occur in clusters with molecules slightly farther apart", "D": "the particles are closely packed together, occupy minimum space and are arranged in a regular pattern"},
   "answer": "A", "explanation": "In the gaseous state molecules are energetic, move freely and spread out to occupy all available space.", "topic": "simple structure of matter"},
  {"text": "A train has an initial velocity of 44m/s and an acceleration of -4m/s^2. Calculate its velocity after 10 seconds.",
   "options": {"A": "10m/s", "B": "6m/s", "C": "8m/s", "D": "4m/s"},
   "answer": "D", "explanation": "v = u + at = 44 + (-4)(10) = 4m/s", "topic": "linear motion"},
  {"text": "Lamps in domestic lightings are usually connected in",
   "options": {"A": "series", "B": "divergent", "C": "convergent", "D": "parallel"},
   "answer": "D", "explanation": "Domestic lamps are connected in parallel so each receives full mains voltage and can be switched independently.", "topic": "current electricity"},
  {"text": "During the transformation of matter from the solid to the liquid state, the heat supplied does not produce a temperature increase because",
   "options": {"A": "all the heat is used to break the bonds holding the molecules of the solid together", "B": "the heat capacity has become very large as the substance melts", "C": "the heat energy is quickly conducted away", "D": "the heat gained is equal to the heat lost by the substance"},
   "answer": "A", "explanation": "At the melting point the supplied latent heat is used to break intermolecular bonds rather than raise temperature.", "topic": "measurement of heat energy"},
  {"text": "In a slide wire bridge, balance is obtained at a point 25cm from one end of a wire 1m long. The resistance to be tested is connected to that end and a standard resistance of 3.6 ohms is connected to the other end of the wire. Determine the value of the unknown resistance.",
   "options": {"A": "3.2 ohms", "B": "1.4 ohms", "C": "3.21 ohms", "D": "1.2 ohms"},
   "answer": "D", "explanation": "R/3.6 = 25/75 = 1/3, so 3R = 3.6, giving R = 1.2 ohms", "topic": "current electricity"},
])

# ---------------- 2018 (edupadi page 1) ----------------
add(2018, "https://edupadi.com/classroom/lessons/jamb/physics/2018/page/1", [
  {"text": "A man walks 1km due east and then 1km due north. His displacement is",
   "options": {"A": "sqrt(2) km N 45 degrees E", "B": "1km N 30 degrees E", "C": "1km N 15 degrees E", "D": "sqrt(2) km N 60 degrees E"},
   "answer": "A", "explanation": "Resultant = sqrt(1^2 + 1^2) = sqrt(2) km, at 45 degrees east of north.", "topic": "scalars and vectors"},
  {"text": "The density of 400cm3 of palm oil was 0.9 gcm-3 before frying. If the density of the oil was 0.6 gcm-3 after frying, assuming no loss of oil due to spilling, its new volume was",
   "options": {"A": "1360cm3", "B": "600cm3", "C": "240cm3", "D": "8000cm3"},
   "answer": "B", "explanation": "Mass = 0.9 x 400 = 360g (constant). New volume = mass/density = 360/0.6 = 600cm3", "topic": "density and relative density"},
  {"text": "Natural radioactivity consists of the emission of",
   "options": {"A": "alpha-particles and beta-rays", "B": "alpha-particles and X-rays", "C": "alpha-particles, beta-rays and gamma-rays", "D": "gamma-rays and X-rays"},
   "answer": "C", "explanation": "Natural radioactive emission comprises alpha particles, beta rays and gamma rays.", "topic": "structure of the nucleus"},
  {"text": "Which of the following is true of an electrical charge?",
   "options": {"A": "Positive charge means deficit of electrons", "B": "Negative charge means excess of electrons", "C": "Electric current means movement of electrons", "D": "All of the above"},
   "answer": "D", "explanation": "", "topic": "current electricity"},
  {"text": "Which of the following does NOT describe the image formed by a plane mirror?",
   "options": {"A": "Erect", "B": "Laterally inverted", "C": "Same distance from mirror as object", "D": "Magnified"},
   "answer": "D", "explanation": "A plane mirror forms an image that is the same size as the object, never magnified.", "topic": "reflection of light"},
  {"text": "Which of the following best describes the energy changes which take place when a steam engine drives a generator which lights a lamp?",
   "options": {"A": "heat -> light -> sound -> kinetic", "B": "kinetic -> light -> heat -> electricity", "C": "heat -> kinetic -> electricity -> heat and light", "D": "electricity -> kinetic -> heat -> light"},
   "answer": "C", "explanation": "Steam (heat) -> moving engine (kinetic) -> generator (electricity) -> lamp (heat and light).", "topic": "energy and power"},
  {"text": "Cathode rays are",
   "options": {"A": "high-energy electromagnetic waves", "B": "protons", "C": "neutrons", "D": "streams of electrons"},
   "answer": "D", "explanation": "Cathode rays are streams of electrons.", "topic": "structure of the atom"},
  {"text": "A narrow beam of white light can be split up into different colours by a glass prism. The correct explanation is that",
   "options": {"A": "white light is an electromagnetic wave", "B": "the prism has all the colours of the white light", "C": "different colours of white light travel with different speeds in glass", "D": "white light has undergone total internal reflection in the prism"},
   "answer": "C", "explanation": "Dispersion occurs because different colours travel at different speeds (have different refractive indices) in glass.", "topic": "refraction of light"},
])

# ---------------- 2020 (edupadi page 1) ----------------
# NOTE: dropped the salt-in-water Q (page answer letter contradicts its own explanation)
# and the 'work done' Q (page concludes 'none' yet marks A) for source-consistency.
add(2020, "https://edupadi.com/classroom/lessons/jamb/physics/2020/page/1", [
  {"text": "The force required to make an object of mass m, travelling with velocity v, turn in a circle of radius r is",
   "options": {"A": "mv^2/r", "B": "mr^2/v", "C": "mr/v", "D": "mv/r^2"},
   "answer": "A", "explanation": "The centripetal force is F = mv^2/r.", "topic": "motion/force/circular motion"},
  {"text": "A machine gun with a mass of 5kg fires a 50g bullet at a speed of 100 ms-1. The recoil speed of the machine gun is",
   "options": {"A": "0.5 ms-1", "B": "1.5 ms-1", "C": "1 ms-1", "D": "2 ms-1"},
   "answer": "C", "explanation": "By conservation of momentum: V = m*v/M = (0.05 x 100)/5 = 1 ms-1", "topic": "momentum/impulse/newton's law of motion"},
  {"text": "If in a simple pendulum experiment the length of the inextensible string is increased by a factor of four, its period is increased by a factor of",
   "options": {"A": "4", "B": "pi/2", "C": "1/4", "D": "2"},
   "answer": "D", "explanation": "T = 2*pi*sqrt(L/g); if L becomes 4L then T becomes 2T, a factor of 2.", "topic": "simple harmonic motion"},
  {"text": "In what range of temperature is the expansion of water anomalous?",
   "options": {"A": "+208 degrees C to +212 degrees C", "B": "-80 degrees C to -76 degrees C", "C": "0 degrees C to +4 degrees C", "D": "-4 degrees C to 0 degrees C"},
   "answer": "C", "explanation": "Water contracts (instead of expanding) when heated from 0 degrees C to 4 degrees C - its anomalous expansion.", "topic": "heat and temperature"},
  {"text": "Which of the following statements about radioactivity is true? (i) Alpha particle is positively charged (ii) Beta particle is negatively charged (iii) Gamma ray is neutral (iv) Beta particle has the same mass as a helium atom (v) Gamma ray is charged.",
   "options": {"A": "i, ii, iii, iv only", "B": "i, ii, iii only", "C": "iv and v only", "D": "i, ii and v only"},
   "answer": "B", "explanation": "Alpha is positive, beta is a negative electron (tiny mass), gamma is neutral radiation. So only i, ii and iii are true.", "topic": "structure of the nucleus"},
  {"text": "In the study of Physics, temperature and heat are often confused with each other. Which of the following statements correctly defines these two elements?",
   "options": {"A": "Temperature is a measure of the average kinetic energy of the molecules of a substance", "B": "Heat is a measure of the total kinetic energy of the molecules in a system", "C": "Different materials require different amounts of heat to cause a given change in temperature", "D": "All of the above"},
   "answer": "D", "explanation": "", "topic": "heat and temperature"},
  {"text": "Which of the following statements on the use of X-rays is incorrect? X-rays are used",
   "options": {"A": "in a hospital to obtain photographs of tissues and bones in the body", "B": "for the treatment of malignant growths like cancer cells", "C": "in detecting fingerprints", "D": "to reveal hidden flaws in metal castings and welded joints"},
   "answer": "C", "explanation": "X-rays are not used to detect fingerprints; the other uses are valid.", "topic": "atomic physics"},
])

# ---------------- 2021 (edupadi page 1) ----------------
add(2021, "https://edupadi.com/classroom/lessons/jamb/physics/2021/page/1", [
  {"text": "The slope of the straight line displacement-time graph indicates",
   "options": {"A": "distance travelled", "B": "uniform velocity", "C": "uniform acceleration", "D": "uniform speed"},
   "answer": "B", "explanation": "The slope of a displacement-time graph is velocity; a straight line means uniform velocity.", "topic": "linear motion"},
  {"text": "A man will exert the greatest pressure when he",
   "options": {"A": "lies flat on his back", "B": "lies on his belly", "C": "stands on both feet", "D": "stands on the toes of one foot"},
   "answer": "D", "explanation": "Pressure is inversely proportional to area; the smallest contact area (toes of one foot) gives the greatest pressure.", "topic": "density and relative density"},
  {"text": "Which of the following physical quantities have derived units? I. Area  II. Thrust  III. Pressure  IV. Mass",
   "options": {"A": "I, II, III and IV", "B": "I, II, and III only", "C": "I, II, and IV only", "D": "I and IV only"},
   "answer": "B", "explanation": "Area, thrust and pressure are derived; mass is a fundamental quantity.", "topic": "fundamental and derived quantities"},
  {"text": "A ball of mass 0.5kg moving at 10 ms-1 collides with another ball of equal mass at rest. If the two balls move off together after the impact, calculate their common velocity.",
   "options": {"A": "0.2 ms-1", "B": "0.5 ms-1", "C": "5.0 ms-1", "D": "5.5 ms-1"},
   "answer": "C", "explanation": "Conservation of momentum: (0.5 x 10) = (0.5 + 0.5)v, so v = 5 ms-1", "topic": "momentum/impulse/newton's law of motion"},
  {"text": "The motion of a body is simple harmonic if the",
   "options": {"A": "acceleration is always directed towards a fixed point", "B": "path of motion is a straight line", "C": "acceleration is proportional to the square of the distance from a fixed point", "D": "acceleration is constant and directed towards a fixed point"},
   "answer": "A", "explanation": "In SHM the restoring acceleration is always directed towards the equilibrium (fixed) point and proportional to displacement.", "topic": "simple harmonic motion"},
  {"text": "Which of the following is not correct about the molecules of a substance in a gaseous state? They",
   "options": {"A": "are in a constant state of motion", "B": "have different speeds", "C": "have a temperature which is measured by the average kinetic energy", "D": "the collisions between the gas molecules are perfectly inelastic"},
   "answer": "D", "explanation": "Collisions between ideal gas molecules are perfectly elastic, not inelastic.", "topic": "thermodynamics"},
  {"text": "A given mass of gas has a pressure of 80 Nm-2 at a temperature of 47 degrees C. If the temperature is reduced to 27 degrees C with volume remaining constant, the new pressure is",
   "options": {"A": "46.0 Nm-2", "B": "75.0 Nm-2", "C": "80.0 Nm-2", "D": "85.3 Nm-2"},
   "answer": "B", "explanation": "P1/T1 = P2/T2: P2 = 80 x 300/320 = 75 Nm-2 (T1=320K, T2=300K).", "topic": "thermodynamics"},
  {"text": "0.5kg of water at 10 degrees C is completely converted to ice at 0 degrees C by extracting 88000 J of heat from it. If the specific heat capacity of water is 4200 Jkg-1 K-1, calculate the specific latent heat of fusion of ice.",
   "options": {"A": "9.0 kJkg-1", "B": "84.0 kJkg-1", "C": "134.0 kJkg-1", "D": "168.0 kJkg-1"},
   "answer": "C", "explanation": "H = mc*dT + mL, so L = H/m - c*dT = 88000/0.5 - 4200x10 = 176000 - 42000 = 134000 Jkg-1 = 134 kJkg-1", "topic": "measurement of heat energy"},
  {"text": "Which of the following instruments may be used to measure relative humidity?",
   "options": {"A": "Hydrometer", "B": "Manometer", "C": "Hygrometer", "D": "Hypsometer"},
   "answer": "C", "explanation": "A hygrometer measures the amount of water vapour (relative humidity) in the air.", "topic": "evaporation and boiling"},
  {"text": "A source of sound produces waves in air of wavelength 1.65m. If the speed of sound in air is 330 ms-1, the period of vibration in air is",
   "options": {"A": "200 s", "B": "0.005 s", "C": "0.5 s", "D": "0.02 s"},
   "answer": "B", "explanation": "v = lambda/T, so T = lambda/v = 1.65/330 = 0.005 s", "topic": "sound wave"},
])

# ---------------- 2022 (edupadi page 1) ----------------
add(2022, "https://edupadi.com/classroom/lessons/jamb/physics/2022/page/1", [
  {"text": "Which of the following is a derived unit?",
   "options": {"A": "Kilogram", "B": "Metre", "C": "Newton", "D": "Second"},
   "answer": "C", "explanation": "The newton (kg m s-2) is a derived unit; kilogram, metre and second are fundamental units.", "topic": "fundamental and derived quantities"},
  {"text": "If a bar magnet is divided into two pieces, which of the following statements is correct?",
   "options": {"A": "two new magnets are created", "B": "the magnetic field of each separate piece becomes stronger", "C": "an electric field is created", "D": "the bar magnet is demagnetized"},
   "answer": "A", "explanation": "Each piece develops its own north and south poles, forming two new magnets.", "topic": "magnetic field"},
  {"text": "Consider the wave equation y = 5mm sin[(1 cm-1)x - (60 s-1)t]. The wave number is",
   "options": {"A": "0.1 cm-1", "B": "10 cm-1", "C": "1.0 cm-1", "D": "2 cm-1"},
   "answer": "C", "explanation": "The wave number k is the coefficient of x in y = A sin(kx - wt), here 1.0 cm-1.", "topic": "waves"},
  {"text": "An object 40 cm high is 30cm from a pinhole camera. If the height of the image formed is 20 cm, what is the distance of the image from the pinhole?",
   "options": {"A": "15 cm", "B": "70 cm", "C": "40 cm", "D": "50 cm"},
   "answer": "A", "explanation": "By similar triangles: image distance/object distance = image height/object height, so v = 30 x (20/40) = 15 cm", "topic": "light and optics"},
  {"text": "A bar magnet is placed near and lying along the axis of a solenoid connected to a galvanometer. The pointer of the galvanometer shows no deflection when",
   "options": {"A": "the magnet is moved towards the stationary solenoid", "B": "there is no relative motion", "C": "the magnet is moved away from the stationary solenoid", "D": "the solenoid is moved away from the stationary magnet"},
   "answer": "B", "explanation": "With no relative motion the magnetic flux does not change, so no e.m.f. is induced and there is no deflection.", "topic": "electromagnetic field"},
  {"text": "Why do tyres have treads?",
   "options": {"A": "to increase the weight of tyres", "B": "to increase friction", "C": "to increase their longevity", "D": "to look good"},
   "answer": "B", "explanation": "Treads increase grip/friction with the road for traction and braking.", "topic": "friction"},
  {"text": "A car starts from rest and covers a distance of 40 m in 10 s. Calculate the magnitude of its acceleration.",
   "options": {"A": "3.20 ms-2", "B": "0.25 ms-2", "C": "0.80 ms-2", "D": "4.00 ms-2"},
   "answer": "C", "explanation": "s = ut + (1/2)at^2 with u=0: 40 = 0.5 x a x 100, so a = 0.80 ms-2", "topic": "equation of motion/motion under gravity"},
  {"text": "The relationship between the coefficient of linear expansion (alpha) and the coefficient of volume expansion (gamma) is",
   "options": {"A": "gamma = alpha^-3", "B": "gamma = alpha", "C": "gamma = 3*alpha", "D": "gamma = alpha^3"},
   "answer": "C", "explanation": "The cubic (volume) expansivity is three times the linear expansivity: gamma = 3*alpha.", "topic": "heat and temperature"},
  {"text": "Which of the following is not a consequence of hydrogen bubbles covering the copper plate of a primary cell?",
   "options": {"A": "formation of hydrogen bubbles on the electrode", "B": "increase in the internal resistance of the cell", "C": "local action", "D": "polarization"},
   "answer": "C", "explanation": "Local action is caused by impurities in the zinc, not by hydrogen bubbles on the copper plate (that is polarization).", "topic": "current electricity"},
  {"text": "A cell whose internal resistance is 0.55 ohm delivers a current of 4 A to an external resistor. What is the lost voltage of the cell?",
   "options": {"A": "4.00 V", "B": "2.20 V", "C": "0.15 V", "D": "8.00 V"},
   "answer": "B", "explanation": "Lost volts = I x r = 4 x 0.55 = 2.20 V", "topic": "current electricity"},
])

# ---------------- 2023 (edupadi page 1) ----------------
add(2023, "https://edupadi.com/classroom/lessons/jamb/physics/2023/page/1", [
  {"text": "The branch of physics that deals with the motion of objects and the forces acting on them is called",
   "options": {"A": "Electromagnetism", "B": "Thermodynamics", "C": "Mechanics", "D": "Quantum mechanics"},
   "answer": "C", "explanation": "Mechanics deals with the motion of objects and the forces acting on them.", "topic": "mechanics"},
  {"text": "How much net work is required to accelerate a 1200 kg car from 10 ms-1 to 15 ms-1?",
   "options": {"A": "1.95 x 10^5 J", "B": "1.35 x 10^4 J", "C": "7.5 x 10^4 J", "D": "6.0 x 10^4 J"},
   "answer": "C", "explanation": "W = (1/2)m(vf^2 - vi^2) = 0.5 x 1200 x (225 - 100) = 75000 J = 7.5 x 10^4 J", "topic": "work/energy/power"},
  {"text": "A generator manufacturing company accidentally made an AC generator instead of a DC generator. To fix this error,",
   "options": {"A": "the magnetic field needs to be made stronger", "B": "the split rings should be replaced with slip rings", "C": "the number of turns of the armature coil needs to be decreased", "D": "the slip rings should be replaced with split rings"},
   "answer": "D", "explanation": "A DC generator uses split rings (a commutator); replacing slip rings with split rings converts AC output to DC.", "topic": "electromagnetic field"},
  {"text": "The half life of a radioactive material is 12 days. Calculate the decay constant.",
   "options": {"A": "0.8663 day-1", "B": "0.04331 day-1", "C": "0.17325 day-1", "D": "0.05775 day-1"},
   "answer": "D", "explanation": "lambda = 0.693/half-life = 0.693/12 = 0.05775 day-1", "topic": "structure of the nucleus"},
  {"text": "Which of the following thermometers measures temperature from the thermal radiation emitted by objects?",
   "options": {"A": "Thermocouple thermometer", "B": "Platinum resistance thermometer", "C": "Pyrometer", "D": "Constant pressure gas thermometer"},
   "answer": "C", "explanation": "A pyrometer measures temperature from the thermal (infrared) radiation emitted by an object.", "topic": "heat and temperature"},
  {"text": "The number of holes in an intrinsic semiconductor",
   "options": {"A": "is not equal to the number of free electrons", "B": "is greater than the number of free electrons", "C": "is equal to the number of free electrons", "D": "is less than the number of free electrons"},
   "answer": "C", "explanation": "In an intrinsic semiconductor each excited electron leaves a hole, so holes equal free electrons.", "topic": "semi conductor"},
  {"text": "A lorry accelerates uniformly in a straight line with acceleration of 4 ms-2 and covers a distance of 250 m in a time interval of 10 s. How far will it travel in the next 10 s?",
   "options": {"A": "650 m", "B": "900 m", "C": "800 m", "D": "250 m"},
   "answer": "A", "explanation": "From 250 = u(10)+0.5(4)(100), u = 5 ms-1. Distance in 20s = 5(20)+0.5(4)(400)=900m; next 10s = 900 - 250 = 650 m", "topic": "equation of motion/motion under gravity"},
  {"text": "The terminals of a battery of emf 24.0 V and internal resistance 1.0 ohm are connected to an external resistor of 5.0 ohms. Find the terminal p.d.",
   "options": {"A": "18.0 V", "B": "12.0 V", "C": "16.0 V", "D": "20.0 V"},
   "answer": "D", "explanation": "I = emf/(R+r) = 24/6 = 4 A; terminal p.d. = emf - I*r = 24 - 4 = 20.0 V", "topic": "current electricity"},
  {"text": "An explosion occurs at an altitude of 312 m above the ground. If the air temperature is -10.00 degrees C, how long does it take the sound to reach the ground? [velocity of sound at 0 degrees C = 331 ms-1]",
   "options": {"A": "0.94 s", "B": "0.96 s", "C": "0.93 s", "D": "0.95 s"},
   "answer": "B", "explanation": "v = 331 + 0.6(-10) = 325 ms-1; t = 312/325 = 0.96 s", "topic": "sound wave"},
  {"text": "When light of a certain frequency is incident on a metal surface, no photoelectrons are emitted. If the frequency of the light is increased above the threshold, what happens to the stopping potential?",
   "options": {"A": "The stopping potential does not change.", "B": "The stopping potential decreases.", "C": "The stopping potential can either increase or decrease, depending on the intensity of the light.", "D": "The stopping potential increases."},
   "answer": "D", "explanation": "Higher frequency gives photoelectrons greater maximum kinetic energy, so a larger stopping potential is required.", "topic": "wave particle paradox"},
])

# ---------------- 2024 (edupadi page 1) ----------------
# NOTE: dropped the 'rectangular solid pressure' Q (page answer letter A=200 contradicts
# its own worked value of 20 N/m2, which is not even an option).
add(2024, "https://edupadi.com/classroom/lessons/jamb/physics/2024/page/1", [
  {"text": "Under which condition is work done?",
   "options": {"A": "A man supports a heavy load on his head with his hands", "B": "A woman holds a pot of water", "C": "A boy climbs onto a table", "D": "A man pushes against a stationary petrol tanker"},
   "answer": "C", "explanation": "Work is done only when a force produces displacement; only the boy climbing involves movement against gravity.", "topic": "work/energy/power"},
  {"text": "When a bus is accelerating, it must be",
   "options": {"A": "changing its speed", "B": "changing its velocity", "C": "changing its position", "D": "changing its direction"},
   "answer": "B", "explanation": "Acceleration is the rate of change of velocity (a vector), which covers changes in speed and/or direction.", "topic": "linear motion"},
  {"text": "Calculate the real depth of a swimming pool if the apparent depth is 10 cm. (Refractive index of water = 1.33)",
   "options": {"A": "7.5 cm", "B": "10.0 cm", "C": "13.3 cm", "D": "6.87 cm"},
   "answer": "C", "explanation": "real depth = refractive index x apparent depth = 1.33 x 10 = 13.3 cm", "topic": "refraction of light"},
  {"text": "The power of a convex lens of focal length 20 cm is",
   "options": {"A": "0.05 D", "B": "0.50 D", "C": "5.00 D", "D": "50.00 D"},
   "answer": "C", "explanation": "P = 1/f = 1/0.2 m = 5.00 D", "topic": "application of lens"},
  {"text": "The energy in a moving car is an example of",
   "options": {"A": "Mechanical energy", "B": "Electrical energy", "C": "Potential energy", "D": "Kinetic energy"},
   "answer": "D", "explanation": "A moving car possesses kinetic energy due to its motion.", "topic": "work/energy/power"},
  {"text": "Which of the following is best as a shaving mirror?",
   "options": {"A": "Concave mirror", "B": "Convex mirror", "C": "Plane mirror", "D": "Parabolic mirror"},
   "answer": "A", "explanation": "A concave mirror gives a magnified, upright image when the face is within its focal length.", "topic": "reflection of light"},
  {"text": "How many joules of heat are given out when a piece of iron of mass 60 g and specific heat capacity 460 Jkg-1 K-1 cools from 75 degrees C to 35 degrees C?",
   "options": {"A": "1000 J", "B": "1050 J", "C": "1067 J", "D": "1104 J"},
   "answer": "D", "explanation": "Q = mc*dT = 0.06 x 460 x 40 = 1104 J", "topic": "measurement of heat energy"},
  {"text": "An electron falls from an energy level of -5.44 eV to another level E. If the emitted photon has wavelength 5.68 x 10^-6 m, calculate the energy change. [Planck's constant = 6.63 x 10^-34 Js, speed of light = 3.0 x 10^8 m/s]",
   "options": {"A": "1.49 x 10^-20 J", "B": "1.49 x 10^-19 J", "C": "3.49 x 10^-20 J", "D": "3.49 x 10^-19 J"},
   "answer": "C", "explanation": "E = hc/lambda = (6.63e-34 x 3.0e8)/(5.68e-6) = 3.49 x 10^-20 J", "topic": "atomic physics"},
])

# ---------------- 2025 (edupadi page 1) ----------------
# NOTE: dropped the electroscope Q (refers to a figure 'shown').
add(2025, "https://edupadi.com/classroom/lessons/jamb/physics/2025/page/1", [
  {"text": "Which device operates based on the magnetic effect produced by an electric current?",
   "options": {"A": "Rheostat", "B": "Thermostat", "C": "Electric bell", "D": "Carbon microphone"},
   "answer": "C", "explanation": "An electric bell uses an electromagnet (magnetic effect of current) to attract an armature and ring.", "topic": "magnetic field"},
  {"text": "What mass of silver will be deposited during electrolysis when a current of 0.8 A flows for 25 minutes?",
   "options": {"A": "0.22 g", "B": "1.86 g", "C": "0.14 g", "D": "1.34 g"},
   "answer": "D", "explanation": "Q = It = 0.8 x 1500 = 1200 C; m = QM/(nF) = 1200 x 107.87/96485 = 1.34 g", "topic": "electrical conduction through liquids and gases"},
  {"text": "The gravitational force between two masses P and Q is 10 N. What will be the force if both masses are doubled while the distance remains unchanged?",
   "options": {"A": "40.0 N", "B": "20.0 N", "C": "10.0 N", "D": "2.5 N"},
   "answer": "A", "explanation": "F is proportional to m1*m2; doubling both multiplies the product by 4, giving 4 x 10 = 40 N.", "topic": "gravitational field"},
  {"text": "A wooden block has a relative density of 0.4 and floats in a liquid whose density is 1600 kg m-3. What proportion of the block's volume remains submerged?",
   "options": {"A": "0.15", "B": "0.10", "C": "0.25", "D": "0.20"},
   "answer": "C", "explanation": "Block density = 0.4 x 1000 = 400 kg m-3; fraction submerged = 400/1600 = 0.25", "topic": "density and relative density"},
  {"text": "The functioning of a photovoltaic cell depends on the action of which material?",
   "options": {"A": "Semi-conductor", "B": "Conductors", "C": "Chemical", "D": "Insulators"},
   "answer": "A", "explanation": "Photovoltaic cells convert light to electricity via the photovoltaic effect in semiconductors such as silicon.", "topic": "semi conductor"},
  {"text": "What is the expression for the power of a lens in dioptres?",
   "options": {"A": "3f", "B": "1/f", "C": "2f", "D": "f"},
   "answer": "B", "explanation": "Lens power P = 1/f, with f in metres.", "topic": "application of lens"},
  {"text": "At what distance from a point charge of 1.2 x 10^-7 C will the electric field intensity be 4.8 x 10^-4 N C-1? [Take 1/(4*pi*e0) = 9.0 x 10^9]",
   "options": {"A": "1.5 km", "B": "3.0 km", "C": "2.0 km", "D": "4.5 km"},
   "answer": "B", "explanation": "E = kq/r^2, so r = sqrt(kq/E) = sqrt(9.0e9 x 1.2e-7/4.8e-4) = sqrt(2.25e6) = 3000 m = 3.0 km", "topic": "electric field"},
  {"text": "Find the heat capacity of a material that absorbs 48 kJ of heat when its temperature increases by 53 degrees C.",
   "options": {"A": "760.8 JK-1", "B": "2500 JK-1", "C": "905.7 JK-1", "D": "260.5 JK-1"},
   "answer": "C", "explanation": "Heat capacity C = Q/dT = 48000/53 = 905.7 JK-1", "topic": "measurement of heat energy"},
])


# ----------------------------------------------------------------------------
# Validation + write
# ----------------------------------------------------------------------------
def clean(s):
    if s is None:
        return ""
    # normalise unicode and collapse whitespace
    s = unicodedata.normalize("NFKC", str(s))
    s = s.replace("​", "").replace("⁡", "").replace("⁢", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s

def main():
    records = []
    seen = set()
    per_year = {}
    for year, url, qs in DATA:
        assert 2016 <= year <= 2025, f"year out of range: {year}"
        for q in qs:
            text = clean(q["text"])
            opts = {k: clean(q["options"][k]) for k in ("A", "B", "C", "D")}
            ans = clean(q["answer"]).upper()
            expl = clean(q.get("explanation", ""))
            topic = clean(q.get("topic", "")) or "general"
            # --- discard rules ---
            if not text:
                continue
            if any(not opts[k] for k in ("A", "B", "C", "D")):
                continue
            if ans not in ("A", "B", "C", "D"):
                continue
            # drop figure-dependent stems defensively
            low = text.lower()
            if any(p in low for p in ["figure above", "figure below", "the diagram", "diagram above",
                                       "diagram below", "shown above", "from the graph", "the graph above",
                                       "in the figure", "the figure shows"]):
                continue
            # dedupe by stem
            key = re.sub(r"[^a-z0-9]", "", low)[:80]
            if key in seen:
                continue
            seen.add(key)
            rec = {
                "subject": "physics",
                "exam": "jamb",
                "year": year,
                "topic": topic,
                "source": "past",
                "difficulty": 2,
                "text": text,
                "options": opts,
                "answer": ans,
                "explanation": expl,
            }
            records.append(rec)
            per_year[year] = per_year.get(year, 0) + 1

    with open(OUT, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(f"WROTE {len(records)} records to {OUT}")
    print("per-year:", dict(sorted(per_year.items())))
    print("distinct years:", sorted(per_year.keys()))

if __name__ == "__main__":
    main()
