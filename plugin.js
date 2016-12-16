var htmlparser = Npm.require('htmlparser2');
var sourcemap = Npm.require('source-map');
var svelte = Npm.require('svelte-es5-meteor');

Plugin.registerCompiler({
  extensions: ['html'],
}, function () {
  return new SvelteCompiler();
});

function SvelteCompiler() {}
var SCp = SvelteCompiler.prototype;

SCp.processFilesForTarget = function (files) {
  files.forEach(function (file) {
    this.processOneFileForTarget(file);
  }, this);
};

SCp.processOneFileForTarget = function (file) {
  var raw = file.getContentsAsString();
  var path = file.getPathInPackage();

  var isSvelteComponent = true;

  // Search for top level head and body tags. If at least one of these tags
  // exists, the file is not processed using the Svelte compiler. Instead, the
  // inner HTML of the tags is added to the respective section in the HTML
  // output produced by Meteor.
  htmlparser.parseDOM(raw).forEach(function (el) {
    if (el.name === 'head' || el.name === 'body') {
      isSvelteComponent = false;

      file.addHtml({
        section: el.name,
        data: htmlparser.DomUtils.getInnerHTML(el)
      });
    }
  });

  if (isSvelteComponent) {
    try {
      var compiled = svelte.compile(raw, {
        filename: path,
        name: file.getBasename()
          .slice(0, -5) // Remove .html extension
          .replace(/[^a-z0-9_$]/ig, '_') // Ensure valid identifier
      });

      file.addJavaScript(this.transpileWithBabel(compiled, path));
    } catch (e) {
      // Throw unknown errors
      if (!e.loc) throw e;

      file.error({
        message: e.message,
        line: e.loc.line,
        column: e.loc.column
      });
    }
  }
};

SCp.transpileWithBabel = function (source, path) {
  var options = Babel.getDefaultOptions();
  options.filename = path;
  options.sourceMap = true;

  var transpiled = Babel.compile(source.code, options);

  return {
    sourcePath: path,
    path: path,
    data: transpiled.code,
    sourceMap: this.combineSourceMaps(transpiled.map, source.map)
  };
};

// Generates a new source map that maps a file transpiled by Babel back to the
// original HTML via a source map generated by the Svelte compiler
SCp.combineSourceMaps = function (babelMap, svelteMap) {
  var result = new sourcemap.SourceMapGenerator();

  var babelConsumer = new sourcemap.SourceMapConsumer(babelMap);
  var svelteConsumer = new sourcemap.SourceMapConsumer(svelteMap);

  babelConsumer.eachMapping(function (mapping) {
    var position = svelteConsumer.originalPositionFor({
      line: mapping.originalLine,
      column: mapping.originalColumn
    });

    // Ignore mappings that don't map to the original HTML
    if (!position.source) {
      return;
    }

    result.addMapping({
      source: position.source,
      original: {
        line: position.line,
        column: position.column
      },
      generated: {
        line: mapping.generatedLine,
        column: mapping.generatedColumn
      }
    });
  });

  // Copy source content from the source map generated by the Svelte compiler.
  // We can just take the first entry because only one file is involved in the
  // Svelte compilation and Babel transpilation.
  result.setSourceContent(
    svelteMap.sources[0],
    svelteMap.sourcesContent[0]
  );

  return result.toJSON();
};