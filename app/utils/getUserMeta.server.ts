import type { userMeta } from "./types";
import { get } from "./redis.server";

export const getSingleUserMeta = async (userId: string): Promise<userMeta> => {
	return await get("userMeta=" + userId);
};

const getUserMeta = (userIds: string[]): Promise<userMeta[]> => {
	return new Promise((res) => {
		const result: { userId: string; data: userMeta }[] = [];
		userIds.forEach(async (id) => {
			result.push({
				userId: id,
				data: await get("userMeta=" + id),
			});
			if (result.length === userIds.length)
				res(
					result
						.sort((a, b) => a.userId.localeCompare(b.userId))
						.map((r) => r.data)
				);
		});
	});
};

export default getUserMeta;
