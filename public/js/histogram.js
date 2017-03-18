function drawHistogram(reference, data) {

  $(reference).empty()

  //The drawing code needs to reference a responsive elements dimensions
  var width = $(reference).width();
  var height = 250;  // We don't want the height to be responsive.

  var histogram = d3.layout.histogram() (data);
   
  var x = d3.scale.ordinal()
      .domain(histogram.map(function(d) { return d.x; }))
      .rangeRoundBands([0, width]);
   
  var y = d3.scale.linear()
      .domain([0, d3.max(histogram.map(function(d) { return d.y; }))])
      .range([0, height]);
   
  var svg = d3.select(reference).append("svg")
      .attr("width", width)
      .attr("height", 2 * height);
   
  svg.selectAll("rect")
      .data(histogram)
      .enter().append("rect")
      .attr("width", x.rangeBand())
      .attr("x", function(d) { return x(d.x); })
      .attr("y", function(d) { return height - y(d.y); })
      .attr("height", function(d) { return y(d.y); });

  svg.append("line")
      .attr("x1", 0)
      .attr("x2", width)
      .attr("y1", height)
      .attr("y2", height)

  var xAxis = d3.svg.axis().scale(x).orient("bottom");
  svg.append("g")
    .attr("class", "x axis")
    .attr("transform", "translate(0," + height + ")")
    .call(xAxis);

  var yAxis = d3.svg.axis().scale(y).orient("top");
  svg.append("g")
    .attr("class", "y axis")
    .attr("transform", "translate(0," + width + ")")
    .call(yAxis);
}

