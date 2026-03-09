export const PRESETS = [
  {
    label: 'Heavy Residential',
    address: '742 Evergreen Terrace, Pasadena, CA 91101',
    shipment: {
      package_type: 'loose',
      total_weight_lbs: 450,
      handling_units: 2,
      dock_available: 'no',
    },
  },
  {
    label: 'Commercial Warehouse',
    address: 'Building 5, Pacific Distribution Center, Ontario, CA 91761',
    shipment: {
      package_type: 'palletized',
      total_weight_lbs: 1200,
      handling_units: 2,
      dock_available: 'yes',
    },
  },
  {
    label: 'School Delivery',
    address: 'Lincoln Elementary School, 400 W Main St, Phoenix, AZ 85001',
    shipment: {
      package_type: 'palletized',
      total_weight_lbs: 400,
      handling_units: 1,
      dock_available: 'no',
    },
  },
  {
    label: 'Borderline Case',
    address: '290 Industrial Pkwy, San Jose, CA 95101',
    shipment: {
      package_type: 'loose',
      total_weight_lbs: 275,
      handling_units: 2,
      dock_available: 'unknown',
    },
  },
];
