// @flow
import React from 'react';
import sinon from 'sinon';
import { expect } from 'chai';
import { shallow } from 'enzyme';

import DeviceVerified from '../DeviceVerified';

describe('<DeviceVerified />', () => {
  it('renders', () => {
    expect(shallow(<DeviceVerified exit={() => {}} />)).to.have.length(1);
  });

  it('calls the exit callback when the button is clicked', () => {
    const exit = sinon.spy();
    const wrapper = shallow(<DeviceVerified exit={exit} />);
    wrapper.childAt(3).simulate('click');
    expect(exit.calledOnce).to.be.true;
  });
});
