import { withCapture } from '@/lib/sentry.js';
import { parameterRepository } from '../repositories/parameter.js';
import type {
	CommunityListQuery,
	CreateParameter,
	ListParametersQuery,
	UpdateParameter,
} from '../types/parameter.js';

type ParameterRow = {
	id: string;
	[key: string]: unknown;
};

async function enrichWithCounts(
	rows: ParameterRow[],
	customerId: string | null,
) {
	const ids = rows.map((r) => r.id);
	const counts = await parameterRepository.getInteractionCounts(ids);
	const userMap = customerId
		? await parameterRepository.getUserInteractions(ids, customerId)
		: null;

	return rows.map((row) => {
		const c = counts.get(row.id);
		const u = userMap?.get(row.id);
		return {
			...row,
			likesCount: c?.likesCount ?? 0,
			savesCount: c?.savesCount ?? 0,
			rating: c?.rating ?? null,
			isSaved: u?.isSaved ?? false,
			isLiked: u?.isLiked ?? false,
			userRating: u?.userRating ?? null,
		};
	});
}

export const parameterService = {
	async list(filters: ListParametersQuery, customerId: string | null) {
		return withCapture(async () => {
			const { data, total } = await parameterRepository.list(
				filters,
				customerId ?? undefined,
			);
			const enriched = await enrichWithCounts(data, customerId);
			return { data: enriched, total };
		});
	},

	async listCommunity(filters: CommunityListQuery, customerId: string | null) {
		return withCapture(async () => {
			const { data, total } = await parameterRepository.listCommunity(filters);
			let enriched = await enrichWithCounts(data, customerId);

			if (filters.sort === 'rating') {
				enriched = enriched.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
			} else if (filters.sort === 'likes') {
				enriched = enriched.sort((a, b) => b.likesCount - a.likesCount);
			}

			return { data: enriched, total };
		});
	},

	async get(id: string, customerId: string | null) {
		return withCapture(async () => {
			const row = await parameterRepository.findById(id);
			if (!row) return null;
			const [enriched] = await enrichWithCounts([row], customerId);
			return enriched;
		});
	},

	async create(
		data: CreateParameter,
		createdBy: string,
		createdByName: string | null,
	) {
		return withCapture(() =>
			parameterRepository.create(data, createdBy, createdByName),
		);
	},

	async update(id: string, data: UpdateParameter) {
		return withCapture(() => parameterRepository.update(id, data));
	},

	async delete(id: string) {
		return withCapture(() => parameterRepository.delete(id));
	},

	async stats() {
		return withCapture(() => parameterRepository.stats());
	},

	async listMachines() {
		return withCapture(() => parameterRepository.listMachines());
	},

	async listMaterials() {
		return withCapture(() => parameterRepository.listMaterials());
	},

	async save(id: string, customerId: string) {
		return withCapture(() =>
			parameterRepository.toggleSave(id, customerId, true),
		);
	},

	async unsave(id: string, customerId: string) {
		return withCapture(() =>
			parameterRepository.toggleSave(id, customerId, false),
		);
	},

	async like(id: string, customerId: string) {
		return withCapture(() => parameterRepository.toggleLike(id, customerId));
	},

	async rate(id: string, customerId: string, rating: number) {
		return withCapture(() => parameterRepository.rate(id, customerId, rating));
	},

	async exportCsv(filters: ListParametersQuery) {
		return withCapture(async () => {
			const { data } = await parameterRepository.list({
				...filters,
				page: 1,
				limit: 1000,
			});
			const header =
				'machine,powerWatts,lens,software,material,mode,speed,power,frequency,line,crossHatch,angle,passes,passesFill,defocus,gas,notes,materialType,thickness\n';
			const rows = data
				.map((p) => {
					const row = p as Record<string, unknown>;
					return [
						row.machine ?? '',
						row.powerWatts ?? '',
						row.lens ?? '',
						row.software ?? '',
						row.material,
						row.mode,
						row.speed,
						row.power,
						row.frequency,
						row.line ?? '',
						row.crossHatch ?? '',
						row.angle ?? '',
						row.passes,
						row.passesFill ?? '',
						row.defocus ?? '',
						row.gas ?? '',
						row.notes ?? '',
						row.materialType ?? '',
						row.thickness ?? '',
					]
						.map((v) => `"${String(v).replace(/"/g, '""')}"`)
						.join(',');
				})
				.join('\n');
			return header + rows;
		});
	},
};
