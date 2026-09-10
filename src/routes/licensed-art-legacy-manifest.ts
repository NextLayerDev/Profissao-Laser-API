/** Registro imutável das licenças QR legadas auditadas. */
export type LegacyLicensedArtSnapshot = {
	code: string;
	valid: boolean;
	status: 'active' | 'revoked';
	content: string;
	featureKey: string;
	licensorName: string | null;
	brandName: string | null;
	crestUrl: string | null;
	accentColor: string | null;
	previewUrl: string | null;
	issuedAt: string;
};

export const LEGACY_LICENSED_ART_BY_HASH = new Map<
	string,
	LegacyLicensedArtSnapshot
>([
	[
		'0be65e3bdb7a5f13c12e398a01a245682c8952f669e2b727de7012e18755506c',
		{
			code: 'PL-B6C7F-F2RZ5-0WQM8-5J3Q3',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/441578a1-e382-4e2b-81d9-71653fd2eba2/001-PL-B6C7F-F2RZ5-0WQM8-5J3Q3.png',
			issuedAt: '2026-08-19T20:34:50.414525+00:00',
		},
	],
	[
		'2dcf7520234a2d7bea43962a4dd82b12a3bcfc2bd947408c38895493189aea55',
		{
			code: 'PL-CCMXQ-TTJHS-CM8H4-2P0HQ',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/441578a1-e382-4e2b-81d9-71653fd2eba2/002-PL-CCMXQ-TTJHS-CM8H4-2P0HQ.png',
			issuedAt: '2026-08-19T20:34:50.414525+00:00',
		},
	],
	[
		'ff8951c4d427beec85db4be92c058c2135d62f238b514a35084f51cc9f347412',
		{
			code: 'PL-WQZ89-F9PVW-0XCBF-M9M9Z',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/05af558a-a6a4-4af2-a7a1-25a181cc2320.png',
			issuedAt: '2026-08-19T03:13:51.15626+00:00',
		},
	],
	[
		'5ef752310374df61861315e6083d48e487bd033d1726583467a231cb008fddb8',
		{
			code: 'PL-SVN0M-6W474-Y06RP-Z3VPW',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/4ab1b1b0-9fe7-4fd3-90d4-42f1ab539a6b.png',
			issuedAt: '2026-08-19T03:28:17.536171+00:00',
		},
	],
	[
		'd2be36c655b4790f3352f00baae460e002732a22d0b6538e062acba548f0b5b0',
		{
			code: 'PL-2E0YM-BQZB6-NS97Z-C4VYD',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/6f7c2409-5478-4dfc-a9fd-ad1d93e09048.png',
			issuedAt: '2026-08-19T02:41:26.444525+00:00',
		},
	],
	[
		'749183adb54cebb80705cfff319d768c76e43aafdde6c8a44eda18ebd568b87e',
		{
			code: 'PL-7TY2C-5YCJM-7FKBW-31MAH',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/bf5721e6-9f24-49f9-95b8-aaecbbdf08c9.png',
			issuedAt: '2026-08-19T02:37:41.914406+00:00',
		},
	],
	[
		'3edb54172fd8fc3548a4bf5707beba879ea5ec1b12d2e2eba22442a5c9ca95dc',
		{
			code: 'PL-98M6M-NDAXY-P2N79-WETTP',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/05a5cd25-05b3-41d3-8637-44c3280947b6.png',
			issuedAt: '2026-08-19T04:32:58.287114+00:00',
		},
	],
	[
		'0b32fffe63f26a58cad14dc657df5eb449b5b6a046d39f72b5b80d79b26e7aee',
		{
			code: 'PL-1494G-V4Y5P-F3MYQ-FT36J',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/8d92254e-125a-4152-ba03-9af77d555a30.png',
			issuedAt: '2026-08-19T12:06:26.551828+00:00',
		},
	],
	[
		'7617752f7038fb2775d313a9fb29f00e4053106424c7e361c20b56d20569fb96',
		{
			code: 'PL-WXQ8W-4Z6NH-1Z8V6-ERKV0',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/PL-WXQ8W-4Z6NH-1Z8V6-ERKV0.png',
			issuedAt: '2026-08-19T15:02:50.254355+00:00',
		},
	],
	[
		'5c828a2a6000ed80b4a4a6a50de0672e21c7ec98e501f4c9b4605caa8c5f9253',
		{
			code: 'PL-AJJCK-8F3TJ-0NT6Z-EBR61',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/PL-AJJCK-8F3TJ-0NT6Z-EBR61.png',
			issuedAt: '2026-08-19T15:18:07.753727+00:00',
		},
	],
	[
		'f5418949d47a0a02655ed3072ed8fc8880bcabef0ce0776bdc3c83939f97a387',
		{
			code: 'PL-Q8K7D-79W31-GYYQ6-7QE4A',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/829c26be-00bc-44a2-9c2f-6ee/002-PL-Q8K7D-79W31-GYYQ6-7QE4A.png',
			issuedAt: '2026-08-19T16:13:30.584358+00:00',
		},
	],
	[
		'217d0ddc7b625d77bbd35f329c65ae0a2dc429c5f0bb04ed68132326a925088d',
		{
			code: 'PL-ZD54J-HCCSC-45S5Z-H90HS',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/829c26be-00bc-44a2-9c2f-6ee/003-PL-ZD54J-HCCSC-45S5Z-H90HS.png',
			issuedAt: '2026-08-19T16:13:30.584358+00:00',
		},
	],
	[
		'e74f846f7679c395e8eb8a1cdd59bf7fa03e9a18245f768986c3aadd1e010689',
		{
			code: 'PL-0K9VP-0YN8A-PWV0E-MKYG6',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/829c26be-00bc-44a2-9c2f-6ee/004-PL-0K9VP-0YN8A-PWV0E-MKYG6.png',
			issuedAt: '2026-08-19T16:13:30.584358+00:00',
		},
	],
	[
		'd4a737436d735189074b98378db69571af2a80b17031cb9f8ed9da0773410635',
		{
			code: 'PL-733Z5-9WMFV-K5H9S-HS66V',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/829c26be-00bc-44a2-9c2f-6ee/005-PL-733Z5-9WMFV-K5H9S-HS66V.png',
			issuedAt: '2026-08-19T16:13:30.584358+00:00',
		},
	],
	[
		'f7d0c61d4330d1ed04bf98429b9c3143c0268887cbb7f6c44e801c7200111d21',
		{
			code: 'PL-CGSKK-V6617-63R41-BG78H',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/829c26be-00bc-44a2-9c2f-6ee/006-PL-CGSKK-V6617-63R41-BG78H.png',
			issuedAt: '2026-08-19T16:13:30.584358+00:00',
		},
	],
	[
		'13ab13ba728847e4d6d1916654d302ef86e8ecac05eb550bf4262bf5eddabc98',
		{
			code: 'PL-NFXFF-22EQZ-174G0-F4XG1',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/829c26be-00bc-44a2-9c2f-6ee/007-PL-NFXFF-22EQZ-174G0-F4XG1.png',
			issuedAt: '2026-08-19T16:13:30.584358+00:00',
		},
	],
	[
		'731ed2e29ba3b62832a892cf4c296e0e10e4ddef91c28f257a81dc4dc778ce46',
		{
			code: 'PL-M5EZS-NTXAV-A49CN-HDDX1',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/a0338421-8bc6-4e4b-b578-e50e605edd75/001-PL-M5EZS-NTXAV-A49CN-HDDX1.png',
			issuedAt: '2026-08-19T20:38:56.772575+00:00',
		},
	],
	[
		'8f7f06f7b51440f991bfbae961ca87f684beeb4cd22c4b46e8d75c94b34cc03a',
		{
			code: 'PL-RYDK9-DV5JR-BJBJT-5MBWP',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/74c727a2-8a7e-4b4a-a942-0014fe6bca0d/001-PL-RYDK9-DV5JR-BJBJT-5MBWP.png',
			issuedAt: '2026-09-08T18:47:26.332108+00:00',
		},
	],
	[
		'c7e847b9f308a771f629bdd0e8d945783a801d8f89f1969e3789ecd86a96d03a',
		{
			code: 'PL-EWNAK-HNK5X-BPN8A-JKZFE',
			valid: true,
			status: 'active',
			content: 'Licenciar Arte',
			featureKey: 'clube:corinthians',
			licensorName: null,
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/b49e0570-1a50-4255-8da1-20b97e1ac497/001-PL-EWNAK-HNK5X-BPN8A-JKZFE.png',
			issuedAt: '2026-09-09T10:12:43.646663+00:00',
		},
	],
	[
		'2dd0832d7ffefd573ab30e8013a1062f0caa971949aa11ed1dd5c7f80a3cec48',
		{
			code: 'PL-XCVYE-C4SZS-JEB6Y-FKMJR',
			valid: true,
			status: 'active',
			content: 'Só licenciar — arte pronta',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/10e5718d-6272-4c32-9def-0b6c1e887ab3/001-PL-XCVYE-C4SZS-JEB6Y-FKMJR.png',
			issuedAt: '2026-09-09T22:17:21.625448+00:00',
		},
	],
	[
		'e4ef07574a24f8351f57fde26ec1566c652f2c9428a89ad0dfe2fc082ff8e470',
		{
			code: 'PL-CVP1D-8K3CB-YGZQX-ED6ST',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/829c26be-00bc-44a2-9c2f-6ee/010-PL-CVP1D-8K3CB-YGZQX-ED6ST.png',
			issuedAt: '2026-08-19T16:13:30.584358+00:00',
		},
	],
	[
		'b281169b647681eab945bb30148a345ca43e10a39ca604b9447d53b6c8fa7ec6',
		{
			code: 'PL-8RJ04-AS98T-1DEJ6-GA03J',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/bc1f7e3b-7075-4f9c-8f85-0dd2db98d48c/001-PL-8RJ04-AS98T-1DEJ6-GA03J.png',
			issuedAt: '2026-08-19T22:44:48.446372+00:00',
		},
	],
	[
		'c19eb1d09ff1d2e31560b0f0e3a209edc1a818dbc266e329a61e51445815bff3',
		{
			code: 'PL-GKZA8-XDAVH-5CZ44-A9QMJ',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/ee21b52e-f1d6-405f-a9a1-3458f8866c54/001-PL-GKZA8-XDAVH-5CZ44-A9QMJ.png',
			issuedAt: '2026-09-08T22:17:02.709373+00:00',
		},
	],
	[
		'aadf1db26313329a637a058ccec8b1a7f971b3294444be9d997f30caf6988579',
		{
			code: 'PL-74Z04-GEWYT-P0VFT-ANN97',
			valid: true,
			status: 'active',
			content: 'Licenciar Arte',
			featureKey: 'clube:corinthians',
			licensorName: null,
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/e6b7ca4a-cc28-4718-872b-e52d32e892e4/001-PL-74Z04-GEWYT-P0VFT-ANN97.png',
			issuedAt: '2026-09-09T10:14:17.143496+00:00',
		},
	],
	[
		'9824d227bae9873966d51823390a8aaaadad00992a18e09e436387e7ee6bae6c',
		{
			code: 'PL-WYVFJ-A4VBN-MM9Q8-5DG3G',
			valid: true,
			status: 'active',
			content: 'Só licenciar — arte pronta',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/870a0bda-c564-48df-a5a2-2d9330102915/001-PL-WYVFJ-A4VBN-MM9Q8-5DG3G.png',
			issuedAt: '2026-09-09T22:24:55.3843+00:00',
		},
	],
	[
		'605d2ba2ddf5fd47a38e6a4109c32ac456a4f709d7d552f0cd86558c8e80fcd5',
		{
			code: 'PL-EGFXN-3YQYA-12ZPM-Q105E',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/829c26be-00bc-44a2-9c2f-6ee/008-PL-EGFXN-3YQYA-12ZPM-Q105E.png',
			issuedAt: '2026-08-19T16:13:30.584358+00:00',
		},
	],
	[
		'5950a997f38d0bde132bdc12c746e9d65fdd58d669a3b7eb829e1bf6ec6e8b85',
		{
			code: 'PL-76MTQ-CHEDK-RKXSB-MFQ72',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/7f65dddc-1025-4767-8e95-6a94ec1d822a/001-PL-76MTQ-CHEDK-RKXSB-MFQ72.png',
			issuedAt: '2026-09-08T13:44:23.661594+00:00',
		},
	],
	[
		'9fdfad3671039f83bbdbe08f08ff448e0a25378904446ec049bb61cdbf23c04d',
		{
			code: 'PL-EK62X-P3H4Y-DD393-ZWXZV',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/fcbc9183-2ced-4ed1-9a95-8040f60bdb25/001-PL-EK62X-P3H4Y-DD393-ZWXZV.png',
			issuedAt: '2026-09-08T22:19:21.570337+00:00',
		},
	],
	[
		'e3b80fcf848dcf370f305ca737ed3afc08316ae9e8cd4e8eeaeae0fb1bade24a',
		{
			code: 'PL-VYX58-ACDQA-Y7FYG-EVCRD',
			valid: true,
			status: 'active',
			content: 'Licenciar Arte',
			featureKey: 'clube:corinthians',
			licensorName: null,
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/eff52c45-2124-4d1d-bb50-b43d5e25ed7f/001-PL-VYX58-ACDQA-Y7FYG-EVCRD.png',
			issuedAt: '2026-09-09T10:21:51.208067+00:00',
		},
	],
	[
		'7158634a84ab9d900fe22e6e6750dd7cb119a898234f91c24aafc018a9a2b32b',
		{
			code: 'PL-4HM96-3EHKE-2P8XQ-MXYEC',
			valid: true,
			status: 'active',
			content: 'Só licenciar — arte pronta',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/2d55c427-fa6b-4b0d-b66a-f8fd5f16474e/001-PL-4HM96-3EHKE-2P8XQ-MXYEC.png',
			issuedAt: '2026-09-09T22:25:18.507171+00:00',
		},
	],
	[
		'75466090df28418920e6b12ba3bf817e0c835d530e837d7e8e7a99cb92e8afc3',
		{
			code: 'PL-VZXTJ-8NHXA-HWRJE-24DH8',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/829c26be-00bc-44a2-9c2f-6ee/001-PL-VZXTJ-8NHXA-HWRJE-24DH8.png',
			issuedAt: '2026-08-19T16:13:30.584358+00:00',
		},
	],
	[
		'bfbf4c9ce24d6d5fff9b069a4eb618c3520ca13ef653593337785cdbdd35bf0e',
		{
			code: 'PL-TTFCG-NR05Y-NC664-XW179',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/882c07ec-2351-4269-a001-f805be87d172/001-PL-TTFCG-NR05Y-NC664-XW179.png',
			issuedAt: '2026-09-08T14:11:04.689918+00:00',
		},
	],
	[
		'16f73df0844fcb69104d1a2ffa94a28cb5f938540527df6b92284463939dca1c',
		{
			code: 'PL-340ZS-E3V86-T5CH7-F72P6',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/2bfc47fd-c06c-47ac-99f1-7174078b943f/001-PL-340ZS-E3V86-T5CH7-F72P6.png',
			issuedAt: '2026-09-08T22:35:21.172018+00:00',
		},
	],
	[
		'573c15e4f1226afda6615f6bd44691785c4b6c8045845cf37abf3aea5227d954',
		{
			code: 'PL-1QHB1-DXHV1-6FEPE-V2P8T',
			valid: true,
			status: 'active',
			content: 'Escudo + Nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/0b4b5bd7-051f-4ba1-a982-a78d9d0ea73a/001-PL-1QHB1-DXHV1-6FEPE-V2P8T.png',
			issuedAt: '2026-09-09T10:35:49.834029+00:00',
		},
	],
	[
		'e80d9c384d0ea28a47ffc367900cd2a4b4f07737f46d0da08484652886dd2822',
		{
			code: 'PL-JR25P-Z6M0Q-M8DR8-9TXZW',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/6371b1b1-2542-469f-85b1-fed0737807bf/001-PL-JR25P-Z6M0Q-M8DR8-9TXZW.png',
			issuedAt: '2026-09-09T23:29:15.551518+00:00',
		},
	],
	[
		'b735210f229236ebe263fc8b006f76749917872ab9bfffb0ec6366f4633962bc',
		{
			code: 'PL-8EE43-XPBV5-302MH-JHBR2',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/829c26be-00bc-44a2-9c2f-6ee/009-PL-8EE43-XPBV5-302MH-JHBR2.png',
			issuedAt: '2026-08-19T16:13:30.584358+00:00',
		},
	],
	[
		'aa92dd70d22e3870892abceb7a601e1b5b4c2777aa54bfbbf13ed03320ff078f',
		{
			code: 'PL-0QTBX-WJDMX-1WPFS-C7W0B',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/507f518f-f79a-416f-bf44-ac2/002-PL-0QTBX-WJDMX-1WPFS-C7W0B.png',
			issuedAt: '2026-08-19T16:28:05.668409+00:00',
		},
	],
	[
		'8f354b8d57a90842f35fc89cd2550df1d399ec90ec80b971d3894a65ea483647',
		{
			code: 'PL-HRRVZ-X25SS-T9P8T-X2TDZ',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/507f518f-f79a-416f-bf44-ac2/005-PL-HRRVZ-X25SS-T9P8T-X2TDZ.png',
			issuedAt: '2026-08-19T16:28:05.668409+00:00',
		},
	],
	[
		'2f28e89f7b95638c9be2c112b4ade174e674c6a9c9d454bddc3441e19321a37d',
		{
			code: 'PL-RN4A8-HF76N-HHY1P-FZAGJ',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/507f518f-f79a-416f-bf44-ac2/001-PL-RN4A8-HF76N-HHY1P-FZAGJ.png',
			issuedAt: '2026-08-19T16:28:05.668409+00:00',
		},
	],
	[
		'b872d858f7b8690ece8a6572740e7b729913b5c6cef725ff8dbfba6d6cbb3b2b',
		{
			code: 'PL-0BQ9F-4BYMN-97812-DRAM9',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/507f518f-f79a-416f-bf44-ac2/007-PL-0BQ9F-4BYMN-97812-DRAM9.png',
			issuedAt: '2026-08-19T16:28:05.668409+00:00',
		},
	],
	[
		'5ea79e44a1af72827c9cc52dbff679766a8028ddc12276c1ad63698ed13d021e',
		{
			code: 'PL-F76VV-Z4DDY-JMWK5-WCK53',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/507f518f-f79a-416f-bf44-ac2/003-PL-F76VV-Z4DDY-JMWK5-WCK53.png',
			issuedAt: '2026-08-19T16:28:05.668409+00:00',
		},
	],
	[
		'bad3d190cc78bc4a43414d040886a7780b843d655a950bb616568870f7646c87',
		{
			code: 'PL-Z15NZ-TWZM1-324XF-9A2T4',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/507f518f-f79a-416f-bf44-ac2/004-PL-Z15NZ-TWZM1-324XF-9A2T4.png',
			issuedAt: '2026-08-19T16:28:05.668409+00:00',
		},
	],
	[
		'4884184afec68366e0ced086467a1c201356889f3c44137248cb611d0ab45a1f',
		{
			code: 'PL-W76P6-JGMD3-YJMKQ-GAPBJ',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/507f518f-f79a-416f-bf44-ac2/010-PL-W76P6-JGMD3-YJMKQ-GAPBJ.png',
			issuedAt: '2026-08-19T16:28:05.668409+00:00',
		},
	],
	[
		'62396f044cee30c941fd20a4e3ba177ba8bc09d78b9a814de46892f017db0779',
		{
			code: 'PL-3QRP2-EEWM1-CVY7P-SW6P0',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/507f518f-f79a-416f-bf44-ac2/008-PL-3QRP2-EEWM1-CVY7P-SW6P0.png',
			issuedAt: '2026-08-19T16:28:05.668409+00:00',
		},
	],
	[
		'60b54cab261bc46fdb35c98a310cebf76163196a3c8bac09824fb878021f4d12',
		{
			code: 'PL-FJDWD-G2226-22V4E-YJR54',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/507f518f-f79a-416f-bf44-ac2/009-PL-FJDWD-G2226-22V4E-YJR54.png',
			issuedAt: '2026-08-19T16:28:05.668409+00:00',
		},
	],
	[
		'28dba3398ac536d510a5a12a46c5642944308ec3e5285e35e9cbdbbd27edb337',
		{
			code: 'PL-BSJSX-K53F7-98HCV-Q19J0',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/507f518f-f79a-416f-bf44-ac2/006-PL-BSJSX-K53F7-98HCV-Q19J0.png',
			issuedAt: '2026-08-19T16:28:05.668409+00:00',
		},
	],
	[
		'1065deaf6bc28c2b884b6057fac28cd2338fdfe083809d6c9fa0f4dcafd06128',
		{
			code: 'PL-8EZPK-BH74Z-FJDYH-R7NSX',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/e74615bc-5829-400f-83c7-fbb2bbec6d3c/001-PL-8EZPK-BH74Z-FJDYH-R7NSX.png',
			issuedAt: '2026-09-08T17:46:59.585036+00:00',
		},
	],
	[
		'360d9b63d5a9babeec5314e753ff958f5eae6ac024480d5308f1ad1e9d756a4b',
		{
			code: 'PL-7593F-GFPSW-RCZFZ-9KH3R',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/55f0afb6-536d-478f-af3f-3be1f1ae2dda/001-PL-7593F-GFPSW-RCZFZ-9KH3R.png',
			issuedAt: '2026-09-08T22:59:43.252571+00:00',
		},
	],
	[
		'5e671a1f039cd6885f16f16142748bbf62e6f6e8846dffa8f6b7bdc245fec48a',
		{
			code: 'PL-7AXMD-01V8C-0YS91-DNZ0V',
			valid: true,
			status: 'active',
			content: 'Escudo + Nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/cf2005f6-a170-446e-9c82-7440a3a56774/001-PL-7AXMD-01V8C-0YS91-DNZ0V.png',
			issuedAt: '2026-09-09T10:39:45.845355+00:00',
		},
	],
	[
		'0ed529d19e9eb72c149878c9649cdd3f9391519bdb2feda75da1316f1d75e0b6',
		{
			code: 'PL-R7T3P-J9X8B-7H1HS-5DM25',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb/001-PL-R7T3P-J9X8B-7H1HS-5DM25.png',
			issuedAt: '2026-08-19T16:56:35.286675+00:00',
		},
	],
	[
		'337b6b0c014ea077053740296ef96213010349d37b68b3edec07a659f1f820aa',
		{
			code: 'PL-9YVA0-ZVER8-FFGB1-5PXKE',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/001-PL-9YVA0-ZVER8-FFGB1-5PXKE.png',
			issuedAt: '2026-08-19T17:37:04.118389+00:00',
		},
	],
	[
		'96255d0adbe43080b4b0a3f302b6645593ec4f19f057f495d4c3bb077a190afd',
		{
			code: 'PL-3Z5VK-KQFH4-388WK-S1XZ4',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/002-PL-3Z5VK-KQFH4-388WK-S1XZ4.png',
			issuedAt: '2026-08-19T17:37:04.118389+00:00',
		},
	],
	[
		'c79f00031afcb87ce20ac9a7e23c29ce53f8b946b58bd2432172360a5a9c3ee9',
		{
			code: 'PL-Q2AB6-5ZAF9-1HTGN-NQ46A',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb/002-PL-Q2AB6-5ZAF9-1HTGN-NQ46A.png',
			issuedAt: '2026-08-19T17:09:47.010627+00:00',
		},
	],
	[
		'3d6361da20cb348c4de188734bab30ed41500a14ade7a586a04325f105fae628',
		{
			code: 'PL-CPSZR-1BKR7-EPZCP-EZX56',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb/003-PL-CPSZR-1BKR7-EPZCP-EZX56.png',
			issuedAt: '2026-08-19T17:09:47.010627+00:00',
		},
	],
	[
		'e0633d9a769a2969faea55dc4cff330a5c80e3cab81121c240aadeac6f929b3a',
		{
			code: 'PL-M6M0A-8QE6A-CVYRK-KWGRV',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb/004-PL-M6M0A-8QE6A-CVYRK-KWGRV.png',
			issuedAt: '2026-08-19T17:09:47.010627+00:00',
		},
	],
	[
		'0c51bbd8d354ac8655ba7a10d599714c1fa63bb21358be7bc96c49999355c30e',
		{
			code: 'PL-E89E3-EKDJB-G1FJG-EQJVD',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb/005-PL-E89E3-EKDJB-G1FJG-EQJVD.png',
			issuedAt: '2026-08-19T17:09:47.010627+00:00',
		},
	],
	[
		'ede57eee0ef170538516a491efc2a4e152f5b1997ba226d326976226d5ce522c',
		{
			code: 'PL-12NMN-5BSK6-D6WPV-NV4VH',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb/006-PL-12NMN-5BSK6-D6WPV-NV4VH.png',
			issuedAt: '2026-08-19T17:09:47.010627+00:00',
		},
	],
	[
		'67ead92e9f812c6fba50b6b59b72bc13b7f0bd208d64b51ddab656a92179a0e2',
		{
			code: 'PL-BBEJR-W4CEB-S929X-0GVCP',
			valid: true,
			status: 'active',
			content: 'Licenciar Arte',
			featureKey: 'clube:corinthians',
			licensorName: null,
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/aa57156b-1dfc-4740-a330-80276ca17ed7/001-PL-BBEJR-W4CEB-S929X-0GVCP.png',
			issuedAt: '2026-09-09T10:47:07.636363+00:00',
		},
	],
	[
		'3d3383b6ee6f0e91eba5c78a6174593cd73d2fdd4863dbdb61f17a3b1106d2ff',
		{
			code: 'PL-8Z6DE-E1H2F-V3FJJ-RRC37',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/f2b0bf84-27c0-45ce-a2ee-c0887b154f59/001-PL-8Z6DE-E1H2F-V3FJJ-RRC37.png',
			issuedAt: '2026-09-08T17:51:14.263114+00:00',
		},
	],
	[
		'b52080136cfd5fa91f7a7dd79ed4fbd2e45dc46a57afa319dda0d917bd8fc3a9',
		{
			code: 'PL-Q3WAT-96B2Q-8598K-0ZY3B',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/462da966-f8a8-449f-9fec-7cf1673cc3cc/001-PL-Q3WAT-96B2Q-8598K-0ZY3B.png',
			issuedAt: '2026-09-08T23:08:45.02287+00:00',
		},
	],
	[
		'04e65c78645ab87ee8b64e1b3a8e213a922dce6fb53993698fa0b355565d3618',
		{
			code: 'PL-CEWJ8-TZWN0-MMN4Y-925TE',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/8f87f183-6139-400d-b31c-7d75f4d955b0/001-PL-CEWJ8-TZWN0-MMN4Y-925TE.png',
			issuedAt: '2026-09-08T17:56:28.594747+00:00',
		},
	],
	[
		'2d548d488208f463a76f91320dc0398528e60613847b942ee902e43b16327ecf',
		{
			code: 'PL-VSDGX-V3A5D-K2MV5-AWGW9',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/99db919b-8b24-400d-a31a-033b2586f549/001-PL-VSDGX-V3A5D-K2MV5-AWGW9.png',
			issuedAt: '2026-09-08T23:09:14.887361+00:00',
		},
	],
	[
		'34494101fed5e7ef1b49c11005296b269d554633d2fb0ec48c157847f2a8c011',
		{
			code: 'PL-S8VVY-9641H-PPFX1-E02NB',
			valid: true,
			status: 'active',
			content: 'Licenciar Arte',
			featureKey: 'clube:corinthians',
			licensorName: null,
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/d92f0be9-dc00-4e5f-a59c-51ba8af22c47/001-PL-S8VVY-9641H-PPFX1-E02NB.png',
			issuedAt: '2026-09-09T10:49:13.544072+00:00',
		},
	],
	[
		'11d6b562dcac3e1ed67d2b02a66f530e8ada72450d051bf1c7518dd663012bb6',
		{
			code: 'PL-JDGCD-373V8-K5PRG-Q5QN3',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/003-PL-JDGCD-373V8-K5PRG-Q5QN3.png',
			issuedAt: '2026-08-19T17:37:04.118389+00:00',
		},
	],
	[
		'a77f3e123bc49083f26c3317056d6556e73381883abbada672213bb32b8c138c',
		{
			code: 'PL-78P4T-EM3SC-0XQPM-EVHD1',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/004-PL-78P4T-EM3SC-0XQPM-EVHD1.png',
			issuedAt: '2026-08-19T17:37:04.118389+00:00',
		},
	],
	[
		'eddc8cc9954267a311507e02cd3ce0e749ff66eb621d2c5e395dc3691100c328',
		{
			code: 'PL-RCT3Q-0E6KA-6WXKX-8YAF7',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/0673e113-372a-4306-9b76-81566532c884/001-PL-RCT3Q-0E6KA-6WXKX-8YAF7.png',
			issuedAt: '2026-09-08T17:57:46.733702+00:00',
		},
	],
	[
		'83f59ccd1820b3e89e1d0397e4631d2c3d9e73b5b124622bd42ead0be74e2544',
		{
			code: 'PL-ZY2MP-X03SD-DX4SP-FAC1A',
			valid: true,
			status: 'active',
			content: 'Escudo + Nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/9ec493d2-c861-4cc5-a630-829afc2153a1/001-PL-ZY2MP-X03SD-DX4SP-FAC1A.png',
			issuedAt: '2026-09-08T23:20:44.972973+00:00',
		},
	],
	[
		'ab5fdf8ee6f59fdf54177c072426d7ce911dc890c27111c67d6694c288898d66',
		{
			code: 'PL-BNQZK-RAZWJ-3VP9K-SM6YJ',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl: null,
			issuedAt: '2026-08-19T17:45:20.23903+00:00',
		},
	],
	[
		'e6805ad797a4d8d36f1d69e49447d4f4a8720c5e23e925411f039c7e6765e5ee',
		{
			code: 'PL-7V3CH-PMZ35-HKHBQ-N0PR8',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl: null,
			issuedAt: '2026-08-19T17:45:20.23903+00:00',
		},
	],
	[
		'e8cdd6e63d1c7e004f0240fd0ec68bbc6ce6df770853d06ae9b0d1306e1e025b',
		{
			code: 'PL-G00T1-W7BFR-K1A49-67WVW',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl: null,
			issuedAt: '2026-08-19T17:45:20.23903+00:00',
		},
	],
	[
		'51b22dd73a5e743f8b48ef2c7222d26d890598c796ac01554c3958014eaebce0',
		{
			code: 'PL-158YX-26S6T-XGKGB-MWS2G',
			valid: true,
			status: 'active',
			content: 'Só licenciar — arte pronta',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/edb96775-9eb0-43e6-bdd3-29f6e3a8f840/001-PL-158YX-26S6T-XGKGB-MWS2G.png',
			issuedAt: '2026-09-09T11:39:15.365304+00:00',
		},
	],
	[
		'87dfe8bb0e1dd3763ef64dd5cd398a8cee6eb6f3e714d5d3f234aeacec0a717f',
		{
			code: 'PL-WXR10-7HGVZ-71XPY-R063Y',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl: null,
			issuedAt: '2026-08-19T17:45:20.23903+00:00',
		},
	],
	[
		'fc3327d4828824b36b8ecca40056fe7a7751b17871ec751616e3d425c203fd2a',
		{
			code: 'PL-M3BQ2-BPZS0-2CTTJ-QH0RB',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb5e78bf81a/012-PL-M3BQ2-BPZS0-2CTTJ-QH0RB.png',
			issuedAt: '2026-08-19T17:45:20.23903+00:00',
		},
	],
	[
		'0b8673185f7ea34b249dfbf157716658e90cd82ffd074ec9481157141d8a3438',
		{
			code: 'PL-YGV6M-SZ9F1-6083Y-CT71C',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb5e78bf81a/014-PL-YGV6M-SZ9F1-6083Y-CT71C.png',
			issuedAt: '2026-08-19T17:45:20.23903+00:00',
		},
	],
	[
		'1072d4cb628770c8368e7704123695b7dd945bc6d775ad3bb9e4b1875ddcc235',
		{
			code: 'PL-1923Z-FX09K-H3JS2-JNFBX',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/015-PL-1923Z-FX09K-H3JS2-JNFBX.png',
			issuedAt: '2026-08-19T17:45:17.509857+00:00',
		},
	],
	[
		'b299c87ad8f99ca336e97352cc05a41a57d40b8c1ad0222740921ffe81582d6d',
		{
			code: 'PL-DHN4Z-268ZV-80T6K-4VGAJ',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/016-PL-DHN4Z-268ZV-80T6K-4VGAJ.png',
			issuedAt: '2026-08-19T17:45:17.509857+00:00',
		},
	],
	[
		'7c2b43f464bb8d5a3130bfd14fe188806dd4e66fec29c5b86670c92906239ec9',
		{
			code: 'PL-B44Q2-CSVJT-M6M4J-J6457',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb5e78bf81a/008-PL-B44Q2-CSVJT-M6M4J-J6457.png',
			issuedAt: '2026-08-19T17:45:20.23903+00:00',
		},
	],
	[
		'bbdaacedfb193e1acfb339a26278328e8ec74586aa6ef898587067ce3a59be4c',
		{
			code: 'PL-7CVAJ-ZJ5EV-FATN9-K6ER0',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb5e78bf81a/010-PL-7CVAJ-ZJ5EV-FATN9-K6ER0.png',
			issuedAt: '2026-08-19T17:45:20.23903+00:00',
		},
	],
	[
		'4dd17a4d576ada4b149d878ba295a161ceec93cc663bd4634d73117e24e243ec',
		{
			code: 'PL-ERN8X-RBATB-9Z7PC-6WRQW',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb5e78bf81a/015-PL-ERN8X-RBATB-9Z7PC-6WRQW.png',
			issuedAt: '2026-08-19T17:45:20.23903+00:00',
		},
	],
	[
		'a94ee590c08a9e46d364fc594aa8eb9554d7f6b3ea2bf3ae4ac9f9df54e318ff',
		{
			code: 'PL-Y6HFT-A3MWX-B4BYS-CHS62',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/005-PL-Y6HFT-A3MWX-B4BYS-CHS62.png',
			issuedAt: '2026-08-19T17:37:04.118389+00:00',
		},
	],
	[
		'799a9a37b53a6e58e3a16fb32c207cd3fbb3336b9fd2e478cc28c95bab1ac9b4',
		{
			code: 'PL-44XZF-NZC6X-3BTSW-0M3DF',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/006-PL-44XZF-NZC6X-3BTSW-0M3DF.png',
			issuedAt: '2026-08-19T17:37:04.118389+00:00',
		},
	],
	[
		'14f54077ec677e485654811aa80901880dd5f34b8aca01c30bd3f4a82bc8d11e',
		{
			code: 'PL-2PPYG-CMGQ4-N4QCC-S84NF',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/007-PL-2PPYG-CMGQ4-N4QCC-S84NF.png',
			issuedAt: '2026-08-19T17:37:04.118389+00:00',
		},
	],
	[
		'7309a5a9dd1679bd818b8cac0ca359ef8e85f7b8bbd9275814ccc9c5f0ab256c',
		{
			code: 'PL-S3Z0Y-T57TQ-K67GB-D93NE',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/008-PL-S3Z0Y-T57TQ-K67GB-D93NE.png',
			issuedAt: '2026-08-19T17:37:04.118389+00:00',
		},
	],
	[
		'4e9a4eca26ed75b8c5133195a48e01e8b7027d57c7e3c89fac11364188a8f5e3',
		{
			code: 'PL-J8AW1-0XTN1-N7YHM-YY1VQ',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/009-PL-J8AW1-0XTN1-N7YHM-YY1VQ.png',
			issuedAt: '2026-08-19T17:37:04.118389+00:00',
		},
	],
	[
		'c600a37d5b30be1d9f65c430b8623e96e7a91a2ea382214921d79c100d98036f',
		{
			code: 'PL-BPQVK-6EXSV-W7EM6-KP2KY',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/010-PL-BPQVK-6EXSV-W7EM6-KP2KY.png',
			issuedAt: '2026-08-19T17:37:04.118389+00:00',
		},
	],
	[
		'a19dbc628794fb8b85e97fe7b8a1733432880fca4f28130b2451c9893a4b131a',
		{
			code: 'PL-SCP4R-SKMM3-RY56G-FZ91Y',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/011-PL-SCP4R-SKMM3-RY56G-FZ91Y.png',
			issuedAt: '2026-08-19T17:45:17.509857+00:00',
		},
	],
	[
		'f89e9f5b3603f1b72d942735fe71a3c108b8db35fbd60713f9c0a6c0cdf41fda',
		{
			code: 'PL-F8C61-NE9FJ-CKDMH-6Y4HH',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/012-PL-F8C61-NE9FJ-CKDMH-6Y4HH.png',
			issuedAt: '2026-08-19T17:45:17.509857+00:00',
		},
	],
	[
		'521fa1a1005aea0af038194b795debf9b647f2581f600341628288e17798116f',
		{
			code: 'PL-W0V21-8J55P-52YKM-4DRJP',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/013-PL-W0V21-8J55P-52YKM-4DRJP.png',
			issuedAt: '2026-08-19T17:45:17.509857+00:00',
		},
	],
	[
		'b6e4cc807e98df34c08ee4364acb9db932ed49d97a28945f7df3548dc55f0092',
		{
			code: 'PL-CSMXB-P3V3Q-280A6-RJB7M',
			valid: true,
			status: 'active',
			content: 'Escudo + Nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/ae48ebbb-a3cf-40dc-a1f0-5b6b192ec8dc/001-PL-CSMXB-P3V3Q-280A6-RJB7M.png',
			issuedAt: '2026-09-08T23:25:18.386701+00:00',
		},
	],
	[
		'2e9205cb0a9090687faa556c86a50b4968fe8ff71ee6a216bddfd8ad4e583294',
		{
			code: 'PL-XAWAG-420QJ-QFA88-339EM',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/1877a6ad-dbc3-4573-b18c-9fb5e78bf81a/007-PL-XAWAG-420QJ-QFA88-339EM.png',
			issuedAt: '2026-08-19T17:45:20.23903+00:00',
		},
	],
	[
		'd5e5eff3af367ed13609550f3e9a2054c1df6de758d79029303724b670cfca72',
		{
			code: 'PL-CGB2W-Q4PAF-1DECP-FN8SA',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/03f81484-e779-4523-b097-fcb33bd93846/001-PL-CGB2W-Q4PAF-1DECP-FN8SA.png',
			issuedAt: '2026-09-08T18:00:41.92148+00:00',
		},
	],
	[
		'6cee1f39542e02d66945fae94ac230d545ab5c50d1e9395f8295b8079bef52b3',
		{
			code: 'PL-PKZ91-ZTTC4-V9RQN-EVFSN',
			valid: true,
			status: 'active',
			content: 'Escudo + Nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/2db19d66-c9ea-4147-b763-31a19f4ae36b/001-PL-PKZ91-ZTTC4-V9RQN-EVFSN.png',
			issuedAt: '2026-09-09T09:55:53.307841+00:00',
		},
	],
	[
		'631051a3c8ad080ced277d710441674bd4f80e9bf4618f8533c4acc7f74ed344',
		{
			code: 'PL-NBCMP-008VH-VJSFK-K0V78',
			valid: true,
			status: 'active',
			content: 'Só licenciar — arte pronta',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/89a4547b-686d-4364-afab-173cf596bcbc/001-PL-NBCMP-008VH-VJSFK-K0V78.png',
			issuedAt: '2026-09-09T11:41:21.691861+00:00',
		},
	],
	[
		'1e2884479a72175119f4ea75ac9249d81ad076348499a472076fd0883609e87e',
		{
			code: 'PL-7S4QY-W1AAY-T911W-K2TCX',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/014-PL-7S4QY-W1AAY-T911W-K2TCX.png',
			issuedAt: '2026-08-19T17:45:17.509857+00:00',
		},
	],
	[
		'1517316cfbb092d63c2d03eb91d89309b3245cf31838d29d050b068dfad15340',
		{
			code: 'PL-0GNKQ-JYJ7S-Q9XJZ-9ZE2J',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/017-PL-0GNKQ-JYJ7S-Q9XJZ-9ZE2J.png',
			issuedAt: '2026-08-19T17:45:17.509857+00:00',
		},
	],
	[
		'9becefd089fb3f85212f088344c9caa858784148c936d7f89651e3ae85c19ddc',
		{
			code: 'PL-97RHN-4492A-AGKY7-4FQ09',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/018-PL-97RHN-4492A-AGKY7-4FQ09.png',
			issuedAt: '2026-08-19T17:45:17.509857+00:00',
		},
	],
	[
		'56e442af134347e2c52bd5be3e9668102a1115c5c6464050ffc8ad66e9eee4a6',
		{
			code: 'PL-37QF9-FAP7G-8E1KP-635R6',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/019-PL-37QF9-FAP7G-8E1KP-635R6.png',
			issuedAt: '2026-08-19T17:45:17.509857+00:00',
		},
	],
	[
		'd4c3db5b327cc5217aae322b9505a9d095110fd28baf47565880e35145c1393b',
		{
			code: 'PL-RVMX5-4TGT0-ZJPHT-BR1A7',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3ca2806d-3396-4546-b2d3-751d3188eb6f/020-PL-RVMX5-4TGT0-ZJPHT-BR1A7.png',
			issuedAt: '2026-08-19T17:45:17.509857+00:00',
		},
	],
	[
		'2b849888d0de0669a1cdbd09fb0cb495204f5b7c76a38ce2dfe8f722c380ecdf',
		{
			code: 'PL-DV76Z-TVFQ3-RFD24-44YQZ',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/4af2585a-8015-49c6-a9b3-5810af783adc/001-PL-DV76Z-TVFQ3-RFD24-44YQZ.png',
			issuedAt: '2026-08-19T17:52:58.643504+00:00',
		},
	],
	[
		'44d6373c179531e8d1b6c2dced04f95156baf0b2a60890d78f47fe39988d7fda',
		{
			code: 'PL-4K7BS-ZFG6H-Z362D-FP9EV',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/9106ff44-9658-45eb-972c-058209e373a2/002-PL-4K7BS-ZFG6H-Z362D-FP9EV.png',
			issuedAt: '2026-08-19T18:27:04.081084+00:00',
		},
	],
	[
		'a3c62cc856eb540eb0fcef268b9fa7d1c749824ba79f69f4f126c8572118862e',
		{
			code: 'PL-JMS1Q-DN5ED-XSD56-J02RS',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/9106ff44-9658-45eb-972c-058209e373a2/001-PL-JMS1Q-DN5ED-XSD56-J02RS.png',
			issuedAt: '2026-08-19T18:27:04.081084+00:00',
		},
	],
	[
		'76cf2eb5ebe894b37531406976344ec53996b3ed471bcebaeeda17b808219fa7',
		{
			code: 'PL-EXF3E-614AJ-BMQ86-6KR69',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/06778dd8-9857-478d-888a-7beab4640145/002-PL-EXF3E-614AJ-BMQ86-6KR69.png',
			issuedAt: '2026-08-19T18:53:12.8797+00:00',
		},
	],
	[
		'74e851684c131b580b92fa941128ff664c17d0fdb6f18d86b56de622671a0748',
		{
			code: 'PL-NN1YG-NHM0Q-2P999-GAK08',
			valid: true,
			status: 'active',
			content: 'Chaveiro — escudo e nome',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/06778dd8-9857-478d-888a-7beab4640145/001-PL-NN1YG-NHM0Q-2P999-GAK08.png',
			issuedAt: '2026-08-19T18:53:12.8797+00:00',
		},
	],
	[
		'8558b0197bee9b15e907165a61409133a024043d1da99a8ea6f7844f5524a1cf',
		{
			code: 'PL-8BZNR-NDZJD-V6SB3-VRPW3',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/3f985d23-7012-4df9-85cd-a8664d032df0/001-PL-8BZNR-NDZJD-V6SB3-VRPW3.png',
			issuedAt: '2026-09-08T18:17:35.287158+00:00',
		},
	],
	[
		'6a409f8579eb2d4ee8f16553fee0d7468d6555dc9fa0e576019c3036424091c2',
		{
			code: 'PL-N5QH8-T91ZP-HHYVN-DBZX9',
			valid: true,
			status: 'active',
			content: 'Caneca 360 — Corinthians',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/a3512fcd-590d-49bb-9d1c-09786776af68/001-PL-N5QH8-T91ZP-HHYVN-DBZX9.png',
			issuedAt: '2026-09-09T10:01:02.006965+00:00',
		},
	],
	[
		'2a13f8a8e6e6a232ac2d33f51e0dc478b3982e41b9e79e125da3da0333929962',
		{
			code: 'PL-VYKWS-DYZ39-RMT4Z-H71NN',
			valid: true,
			status: 'active',
			content: 'Só licenciar — arte pronta',
			featureKey: 'clube:corinthians',
			licensorName: 'Corinthians',
			brandName: 'Corinthians',
			crestUrl:
				'https://pull-profissao.b-cdn.net/licensed-brands/1cef7656-320a-45e6-ba52-1868f37b85ac.png',
			accentColor: '#000000',
			previewUrl:
				'https://pull-profissao.b-cdn.net/arte-licenciada/1a3d36ef-bb5e-446d-93d1-a7a725af9aec/8492bb1b-bcf8-4506-af59-4fd6c8702ec5/001-PL-VYKWS-DYZ39-RMT4Z-H71NN.png',
			issuedAt: '2026-09-09T16:01:09.182464+00:00',
		},
	],
]);
