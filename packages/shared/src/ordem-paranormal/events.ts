import { EventEmitter } from "node:events";
import type { OrdemCharacter } from "./types";
import type { OrdemPokedexEntry } from "./storage";

export interface OrdemDiscoveryEvent {
	character: OrdemCharacter;
	entry: OrdemPokedexEntry;
	isFirstDiscovery: boolean;
}

class OrdemEvents extends EventEmitter {}

export const ordemDiscoveryEmitter = new OrdemEvents();
