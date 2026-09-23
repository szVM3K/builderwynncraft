import { defineSoakShard } from "../harness/soak.js";

defineSoakShard(1, Number(process.env.SOAK_SHARDS || 4));
