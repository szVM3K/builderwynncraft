import { defineDeepSuite } from "../harness/deep.js";

defineDeepSuite("a", [
  ["Mage", "Riftwalker", 80, 25],
  ["Shaman", "Acolyte", 95, 0],
  ["Warrior", "Battle Monk", 80, 30, "first"],
  ["Archer", "Boltslinger", 60, 30],
]);
