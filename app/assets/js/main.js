// dummy grammar ID: 948a562c40cc36de62ca

var utils = require('./utils')
var storage = require('./storage')
var exportGrammar = require('./export')
var catchphraseGenerator = require('./generators/catchphrase.generator.js')
var transforms = {
	children: [
		// common
		require('./transforms/builtin'),
		require('./transforms/common'),

		// word classes
		require('./transforms/adjective'),
		require('./transforms/noun'),
		require('./transforms/verb'),
	]
}

// catchprase generator
$('.catchphrase .text')
	.text(catchphraseGenerator.catchphrase())
	.click(function() {
		$(this).text(catchphraseGenerator.catchphrase())
	})

// vue util functions
function getExportedNodes(node) {
	var ret = []
	if (node.children && node.children.length) {
		node.children.forEach(function(child) {
			ret = ret.concat(getExportedNodes(child))
		})
	}
	if (node.export === true) {
		ret.push(node)
	}
	return ret
}

function getNodeCache() {
	var ret = {}
	function getNodes(node, parent) {
		if (node.id) {
			ret[node.id] = { node: node, parent: ret[parent.id] }
		}
		if (node.children && node.children.length) {
			node.children.forEach(function(child) {
				getNodes(child, node)
			})
		}
	}
	for (var i = 0; i < arguments.length; i += 1) {
		getNodes(arguments[i])
	}
	return ret
}

function addContextSubmenu(node, parent) {
	var id = 'node:' + node.id
	parent[id] = { name: node.label }
	if (node.tag) {
		parent[id].name = '<span class="tag-container"><span class="label">' + node.label + '</span> <span class="tag">' + node.tag + '</span></span>'
	}
	if (node.children) {
		var children = node.children.slice(0)
		parent[id].items = {}
		children.sort(function (a, b) {
			if (a.label > b.label) {
				return 1
			}
			if (a.label < b.label) {
				return -1
			}
			return 0
		})
		children.forEach(function(el) {
			addContextSubmenu(el, parent[id].items)
		})
	}
}

function generateId() {
	return Math.random().toString(36).substr(2, 10)
}

Vue.component('grammar', {
	template: '#grammar-template',
	data: {
		open: false,
	},
})

Vue.component('container-wordlist', {
	template: '#container-wordlist-template',
	methods: {
		addString: function(ev) {
			var value = ev.target.value.trim().toLowerCase()

			// check for duplicates
			if (!this.$data.elements.some(function(el) {
				return el === value
			})) {
				this.$data.elements.push(value)
			}

			ev.target.value = ''
		},
	},
})

Vue.component('container-sentence', {
	template: '#container-sentence-template',
	methods: {
		filterTransforms: function(transformList, type) {
			var ret = []
			var nc = this.$root.nodeCache

			;(transformList || []).forEach(function(ref) {
				if (!nc.hasOwnProperty(ref)) {
					return
				}
				var tf = nc[ref].node
				if (tf.type === type) {
					ret.push(tf)
				}
			})

			return ret
		},
		updatePreview: function(model) {
			// add and remove a property to force an update
			// this will update it twice, but at least it works
			model.$add('preview', true)
			model.$delete('preview')
		},
	},
})

var vm = new Vue({
	el: 'body',
	data: {
		grammar: storage.load(),
		transforms: transforms,
		nodeCache: {},
		exported: [],
	},
	lazy: true,
	created: function() {
		function createNodeCache(obj) {
			// store flat cache of all nodes with parents
			var nodeCache = getNodeCache(obj.grammar, obj.transforms)
			for (var n in nodeCache) {
				if (nodeCache.hasOwnProperty(n)) {
					obj.nodeCache[n] = nodeCache[n]
				}
			}
		}
		createNodeCache(this)

		this.$watch('grammar', function(grammar) {
			// walk the grammar tree and detect any exported nodes
			this.exported = getExportedNodes(grammar)
			createNodeCache(this)

			// make sure any new inputs are autosized
			$('input[data-autosize-input]').autosizeInput()

			// backup grammar in local storage
			storage.save(this)
		})
	},
	methods: {
		generateId: generateId,
		getGrammarNode: function(searchPath) {
			var node = this.nodeCache[searchPath]
			if (typeof node === 'undefined') {
				return []
			}
			var searchNode = node
			var components = [node.node]
			while (searchNode.parent) {
				searchNode = searchNode.parent
				components.unshift(searchNode.node)
			}

			return components
		},
		getGrammarComponents: function(searchPath) {
			var nodes = this.getGrammarNode(searchPath)
			if (!nodes.length) {
				return [{
					label: '<<missing word>>',
					key: '',
				}]
			}
			return nodes.map(function(el) {
				return {
					label: el.label,
					key: S(el.label).slugify().toString(),
				}
			})
		},
		getGrammarComponentPreview: function(node) {
			var cachedNode = this.nodeCache[node.ref]
			if (typeof cachedNode === 'undefined') {
				return '<<invalid reference>>'
			}
			var item = utils.randomItem(cachedNode.node.elements)
			if (typeof item === 'undefined') {
				return '<<empty word list>>'
			}

			// apply transforms
			if (node.transform) {
				node.transform.forEach(function(transform) {
					var node = this.nodeCache[transform].node
					if (node.fn) {
						// apply transform function
						item = node.fn(item)
					}
					else if (node.re) {
						// apply transform regexp
						item = utils.replaceRegexp(item, node.re)
					}
				}.bind(this))
			}

			return item
		},
		getRawGrammar: function() {
			// sanitize grammar
			// remove disallowed keys
			// remove empty properties
			var grammar = {}
			var allowedKeys = [
				'children', 'elements', 'type', 'label', 'comment',
				'id', 'str', 'ref', 'variable', 'sentence', 'transform',
				'name', 'author', 'export', 'whitespace',
			]

			function sanitizeGrammar(node, parent) {
				for (var key in node) {
					if (node.hasOwnProperty(key)) {
						if (node[key] === '' || node[key] === [] || node[key] === {}) {
							continue
						}

						if (Array.isArray(node[key])) {
							parent[key] = []
							node[key].forEach(function(value, idx) {
								if (typeof value === 'object') {
									parent[key][idx] = {}
									sanitizeGrammar(value, parent[key][idx])
								}
								else if (typeof value === 'string') {
									parent[key][idx] = value
								}
							})
						}
						else if (allowedKeys.indexOf(key) > -1) {
							parent[key] = node[key]
						}
					}
				}
			}
			sanitizeGrammar(this.$root.grammar, grammar)

			return grammar
		},
		exportRawGrammar: function() {
			var grammar = this.getRawGrammar()
			var data = JSON.stringify(grammar, undefined, '\t')
			window.open('data:application/json;' +
			            (window.btoa ? 'base64,' + btoa(data)
			             : data))
		},
		exportGrammarGenerator: function() {
			var data = exportGrammar(vm)

			window.open('data:application/json;' +
			            (window.btoa ? 'base64,' + btoa(data)
			             : data))
		},
		addChild: function(node) {
			if (!node.children) {
				node.$add('children', [])
				node.children = []
			}
			node.children.push({
				id: generateId(),
			})
		},
		addWordlist: function(model) {
			model.id = generateId()
			model.type = 'wordlist'
			model.elements = []
		},
		addSentence: function(model) {
			model.id = generateId()
			model.type = 'sentence'
			model.elements = []
		},
		menuAddElement: function(node, sentence) {
			var selector = '.menu-add-element'
			var nodeCache = this.$root.nodeCache
			var grammar = this.$root.grammar

			$.contextMenu({
				selector: selector,
				trigger: 'none',
				determinePosition: function($menu) {
					$menu
						.css('display', 'block')
						.position({ my: 'left top', at: 'right bottom-100%', of: this })
						.css('display', 'none')
				},
				events: {
					hide: function() {
						// destroy all context menus
						setTimeout(function(){ $.contextMenu('destroy') }, 0)
					},
				},
				callback: function(key, options) {
					if (key.indexOf('node') !== -1) {
						var keyNode = nodeCache[key.split(':')[1]].node
						if (keyNode.type === 'wordlist' || keyNode.type === 'sentence') {
							sentence.push({ ref: keyNode.id })
						}
					}
					else {
						switch (key) {
						case 'staticString':
							sentence.push({ str: '', editStr: true })
							break
						}
					}
				},
				items: (function() {
					// build menu tree
					var menu = {
						staticString: { name: 'Static string' },
					}

					addContextSubmenu({
						id: 'reference',
						label: 'Reference',
						children: grammar.children,
					}, menu)

					return menu
				})(),
			})
			$(node.$el).find(selector).contextMenu()
		},
		menuUpdateSentenceStr: function(node, element, sentence) {
			var selector = '.menu-update-sentence-str'
			var nodeCache = this.$root.nodeCache
			var grammar = this.$root.grammar

			$.contextMenu({
				selector: selector,
				trigger: 'none',
				determinePosition: function($menu) {
					$menu
						.css('display', 'block')
						.position({ my: 'left top', at: 'right bottom-100%', of: this })
						.css('display', 'none')
				},
				events: {
					hide: function() {
						// destroy all context menus
						setTimeout(function(){ $.contextMenu('destroy') }, 0)
					},
				},
				callback: function(key, options) {
					if (key.indexOf('node') !== -1) {
						var keyNode = nodeCache[key.split(':')[1]].node
						if (keyNode.type === 'wordlist' || keyNode.type === 'sentence') {
							// clear any element modifiers
							element.$delete('transform')
							element.$delete('str')
							element.$delete('ref')
							element.$delete('variable')

							element.$add('ref', keyNode.id)
						}
					}
					else {
						switch (key) {
						case 'edit':
							element.editStr = true
							break
						case 'remove':
							sentence.$remove(element)
							break
						}
					}
				},
				items: (function() {
					// build menu tree
					var menu = {
						edit: { name: 'Edit string' },
						properties: {
							name: 'Properties',
							items: {
								appendWhitespace: {
									name: 'Append whitespace',
									type: 'checkbox',
									selected: (typeof node.element.whitespace === 'undefined' ? true : node.element.whitespace),
									events: {
										click: function(ev) {
											if (!node.element.whitespace) {
												node.element.$add('whitespace')
											}
											node.element.whitespace = ev.target.checked
										},
									},
								},
							},
						},
						div1: '---',
					}

					addContextSubmenu({
						id: 'convertToReference',
						label: 'Convert to reference',
						children: grammar.children,
					}, menu)

					menu.div2 = '---'
					menu.remove = { name: 'Remove', className: 'remove' }

					return menu
				})(),
			})
			$(node.$el).find(selector).contextMenu()
		},
		menuUpdateSentenceRef: function(node, element, sentence) {
			var selector = '.menu-update-sentence-ref'
			var nodeCache = this.$root.nodeCache
			var grammar = this.$root.grammar
			var transforms = this.$root.transforms

			$.contextMenu({
				selector: selector,
				trigger: 'none',
				determinePosition: function($menu) {
					$menu
						.css('display', 'block')
						.position({ my: 'left top', at: 'right bottom-100%', of: this })
						.css('display', 'none')
				},
				events: {
					hide: function() {
						// destroy all context menus
						setTimeout(function(){ $.contextMenu('destroy') }, 0)
					},
				},
				callback: function(key, options) {
					if (key.indexOf('node') !== -1) {
						var keyNode = nodeCache[key.split(':')[1]].node
						if (keyNode.fn || keyNode.re) {
							if (!element.transform) {
								element.$add('transform', [])
								element.transform = []
							}
							if (element.transform.indexOf(keyNode.id) === -1) {
								// make sure the transform isn't already applied to this element
								element.transform.push(keyNode.id)
							}
						}
						else if (keyNode.type === 'wordlist' || keyNode.type === 'sentence') {
							// clear any element modifiers
							element.$delete('transform')
							element.$delete('str')
							element.$delete('ref')
							element.$delete('variable')

							element.$add('ref', keyNode.id)
						}
					}
					else {
						switch (key) {
						case 'clearTransforms':
							element.$delete('transform')
							break
						case 'remove':
							sentence.$remove(element)
							break
						}
					}
				},
				items: (function() {
					// build menu tree
					var menu = {}

					addContextSubmenu({
						id: 'transform',
						label: 'Transform',
						children: transforms.children,
					}, menu)

					menu.properties = {
						name: 'Properties',
						items: {
							appendWhitespace: {
								name: 'Append whitespace',
								type: 'checkbox',
								selected: (typeof node.element.whitespace === 'undefined' ? true : node.element.whitespace),
								events: {
									click: function(ev) {
										if (!node.element.whitespace) {
											node.element.$add('whitespace')
										}
										node.element.whitespace = ev.target.checked
									},
								},
							},
							assignVariable: {
								name: 'Variable reference:',
								type: 'text',
								value: node.element.variable,
								events: {
									keyup: function(ev) {
										if (!node.element.variable) {
											node.element.$add('variable', ev.target.value)
										}
										node.element.variable = ev.target.value
									},
								},
							},
						}
					}

					menu['node:transform'].items.div1 = '---'
					menu['node:transform'].items.clearTransforms = { name: 'Clear transforms', className: 'remove' }

					menu.div1 = '---'

					addContextSubmenu({
						id: 'changeReference',
						label: 'Change reference',
						children: grammar.children,
					}, menu)

					menu.convertToString = { name: 'Convert to string' },
					menu.div3 = '---'
					menu.remove = { name: 'Remove', className: 'remove' }

					return menu
				})(),
			})
			$(node.$el).find(selector).contextMenu()
		},
	},
})

// popup windows
function popupAlert(text, iconClass, buttonText) {
	$('#popup-alert .text').html(text)
	$('#popup-alert .btn').text((buttonText || 'OK'))
	$('#popup-alert .icon').attr('class', 'icon ' + (iconClass || 'info'))

	$.magnificPopup.open({
		mainClass: 'mfp-transition-zoom-in',
		removalDelay: 300,
		preloader: false,
		closeBtnInside: false,
		callbacks: {
			open: function() {
				setTimeout(function() {
					$('#popup-alert button').focus()
				}, 100)
			}
		},
		items: {
			type: 'inline',
			src: '#popup-alert',
		},
	})
}
$('#popup-alert button').click(function() {
	$.magnificPopup.close()
})

$('#import-grammar').magnificPopup({
	type: 'inline',
	preloader: false,
	closeBtnInside: false,
	removalDelay: 300,
	mainClass: 'mfp-transition-zoom-in',
	callbacks: {
		open: function() {
			setTimeout(function() {
				$('#popup-import-grammar input[name=gist-uri]').focus()
			}, 100)
		},
		afterClose: function() {
			var gistUri = $('#popup-import-grammar input[name=gist-uri]')
			var gistUriVal = gistUri.val()
			gistUri.val('')

			if (gistUriVal) {
				importGist(gistUriVal)
				return
			}

			var jsonText = $('#popup-import-grammar textarea')
			var jsonTextVal = jsonText.val()
			jsonText.val('')

			if (jsonTextVal) {
				importJson(jsonTextVal)
			}
		},
	},
})
$('#popup-import-grammar input[name=gist-uri]').keydown(function(ev) {
	if (ev.keyCode === 13) {
        $.magnificPopup.close()
	}
})
$('#popup-import-grammar button').click(function() {
	$.magnificPopup.close()
})

// import functions
function importJson(jsonText) {
	if (!jsonText) {
		console.warn('Missing JSON text')
		return
	}
	var jsonObj
	try {
		jsonObj = JSON.parse(jsonText)
	}
	catch (e) {
		popupAlert('An error occured while parsing the JSON string: ' + e, 'error')
		return
	}
	if (!jsonObj) {
		console.warn('Empty JSON object')
		return
	}
	vm.grammar = jsonObj
    console.log('JSON text imported successfully!')
}

function importGist(uri) {
	if (!uri) {
		popupAlert('Could not import grammar: missing gist URI or ID.', 'error')
		return
	}

	var id = uri.split('/').slice(-1)[0]
	var queryUri = 'https://api.github.com/gists/' + id

	$.getJSON(queryUri)
		.done(function(data) {
			var grammar = ''
			for (var file in data.files) {
				if (data.files.hasOwnProperty(file)) {
					// only read first item
					// TODO handle multiple items by prompting the user?
					try {
						grammar = JSON.parse(data.files[file].content)
						break
					}
					catch (e) {
						popupAlert('Could not import JSON: ' + e, 'error')
						return
					}
				}
			}

			if (!grammar) {
				popupAlert('Could not read any files from the gist!', 'error')
				return
			}

			popupAlert('The grammar <strong>' + grammar.name + '</strong> by <strong>' + grammar.author + '</strong> was successfully imported.')
			vm.grammar = grammar
		})
		.fail(function() {
			popupAlert('Could not import grammar: invalid gist URI or ID.', 'error')
		})
}

// handle gist ID/URI in query string
if (window.location.hash) {
	var split = window.location.hash.substring(1).split(':')
	switch (split[0]) {
	case 'gist':
		importGist(split[1])
	}
}
