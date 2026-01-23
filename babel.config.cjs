const plugins = [
	[
		'module-resolver',
		{
			root: ['./src'],
			alias: {
				'@': './src',
			},
			extensions: ['.js', '.jsx', '.ts', '.tsx'],
		},
	],
	['babel-plugin-add-import-extension', { extension: 'js' }],
];

if (process.env.NODE_ENV === 'production') {
	plugins.push('transform-remove-console');
}

module.exports = {
	presets: [
		[
			'@babel/preset-env',
			{
				targets: {
					node: 'current',
				},
				modules: false,
			},
		],
		'@babel/preset-typescript',
	],
	plugins,
};
