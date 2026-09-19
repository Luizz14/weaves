import { z } from "zod";

export const ordemElementSchema = z.enum([
	"Sangue",
	"Morte",
	"Conhecimento",
	"Energia",
	"Medo",
	"Nenhum",
]);
export type OrdemElement = z.infer<typeof ordemElementSchema>;

export const ordemCategorySchema = z.enum([
	"personagem",
	"criatura",
	"reliquia",
]);
export type OrdemCategory = z.infer<typeof ordemCategorySchema>;

export const ordemCharacterSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	category: ordemCategorySchema,
	element: ordemElementSchema,
	season: z.string().min(1),
	role: z.string().min(1),
	description: z.string().min(1),
	imageUrl: z.string().url(),
	quote: z.string().optional(),
});
export type OrdemCharacter = z.infer<typeof ordemCharacterSchema>;

export type OrdemCharacterStatus = OrdemCharacter & {
	isUsed: boolean;
	activeBranch: string | null;
};
