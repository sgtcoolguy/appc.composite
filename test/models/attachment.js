module.exports = function (Arrow) {
	return Arrow.Model.extend('attachment', {
		fields: {
			attachment_content: { name: 'content', type: String }
		},
		connector: 'appc.mongo',

		metadata: {
			'appc.mongo': {
				table: 'Composite_Attachment'
			}
		}
	});
};