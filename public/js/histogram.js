function drawHistogram(reference, data, mypoint) {
  $(reference).empty();

  //The drawing code needs to reference a responsive elements dimensions
  var width = $(reference).width();
  var height = 250; // We don't want the height to be responsive.
  //data = data.map(function(x) { return Math.floor(x); })
  //data.push(80);
  //data = d3.range(1000).map(d3.random.normal(20, 5));
  max = -1;
  min = Infinity;
  for (var i = 0; i < data.length; i++) {
    max = Math.max(max, data[i]);
    min = Math.min(min, data[i]);
  }

  var histogram = d3.layout.histogram().bins(Math.max(10, max / 2))(data);

  var x = d3.scale
    .ordinal()
    .domain(
      histogram.map(function(d) {
        return d.x;
      })
    )
    .rangeRoundBands([40, width + 40]);

  function xscale(xval) {
    return 40 + (width * (xval - min)) / max;
  }
  var ymax = d3.max(
    histogram.map(function(d) {
      return d.y;
    })
  );
  var y = d3.scale
    .linear()
    .domain([0, ymax])
    .range([height, 40]);

  var svg = d3
    .select(reference)
    .append("svg")
    .attr("width", 2 * width)
    .attr("height", 2 * height);

  svg
    .selectAll("rect")
    .data(histogram)
    .enter()
    .append("rect")
    .attr("width", x.rangeBand())
    .attr("x", function(d) {
      return x(d.x);
    })
    .attr("y", function(d) {
      return y(d.y);
    })
    .attr("height", function(d) {
      return height - y(d.y);
    });

  svg
    .append("text")
    .attr("class", "x label")
    .attr("text-anchor", "end")
    .attr("x", width / 2)
    .attr("y", height + 30)
    .text("Runtime in seconds ->");

  svg
    .append("text")
    .attr("class", "y label")
    .attr("text-anchor", "end")
    .attr("x", -height / 4)
    .attr("y", 0)
    .attr("dy", ".75em")
    .attr("transform", "rotate(-90)")
    .text("Number of submissions ->");

  var ticks = x.domain().filter(function(d, i) {
    return !(i % 3);
  });
  var formatxAxis = d3.format(".0f");

  var xAxis = d3.svg
    .axis()
    .scale(x)
    .orient("bottom")
    .tickFormat(formatxAxis);
  svg
    .append("g")
    .attr("class", "x axis")
    .attr("transform", "translate(0," + height + ")")
    .call(xAxis.tickValues(ticks));

  var yAxis = d3.svg
    .axis()
    .scale(y)
    .orient("left");
  svg
    .append("g")
    .attr("class", "y axis")
    .attr("transform", "translate(" + 40 + ",0)")
    .call(yAxis.ticks(5, "d"));

  let g = svg
    .append("g")
    .selectAll("line")
    .data([{ y1: 0, y2: ymax, x1: mypoint, x2: mypoint }]);

  g.enter()
    .append("line")
    .attr("class", "specification-line")
    .attr("y1", function(d) {
      return y(d.y1);
    })
    .attr("y2", function(d) {
      return y(d.y2);
    })
    .attr("x1", function(d) {
      return xscale(d.x1);
    })
    .attr("x2", function(d) {
      return xscale(d.x2);
    });
  g.enter()
    .append("text")
    .text(mypoint + "s")
    .attr("x", function(d) {
      return xscale(mypoint);
    })
    .attr("y", function(d) {
      return y(ymax);
    });
}
