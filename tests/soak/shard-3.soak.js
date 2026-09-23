import { defineSoakShard } from "../harness/soak.js";

defineSoakShard(3, Number(process.env.SOAK_SHARDS || 4));
